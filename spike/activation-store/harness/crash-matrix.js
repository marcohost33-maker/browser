// Crash matrix for the activation store.
//
// For every scenario the operation is interrupted before each of its mutating
// filesystem calls in turn (plus one uninterrupted run). Each interrupted machine is
// then observed through the persistence models of `model-fs.js`, recovered by a new
// process and checked against the invariants below. Negative controls re-run selected
// scenarios with fsync calls silently dropped; a sound matrix must report violations
// for them, otherwise it could not detect a broken protocol at all.
//
// Invariants after `recover()`:
// - recovery succeeds and the committed state is exactly the old or the new one;
// - active, last-good and commit bindings fully verify (every object re-hashed);
// - no temporary file, commit temporary or lock remains;
// - under a variant whose barrier the model honours, a state that was durably
//   committed before the crash is never lost (including the state of an operation
//   that returned), and recovery's own barriers make the visible state durable;
// - a reconciling retry reaches the new state, after which the object store holds
//   exactly the objects reachable from active, last-good and bindings.

import { createHash } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ACTIVATION_SCHEMA, canonicalBytes, openActivationStore } from '../activation-store.js';
import { createNodeIo } from '../node-io.js';
import { createCrashingIo, createLyingIo, SimulatedCrash } from './fault-injection.js';
import { ModelFs } from './model-fs.js';

export const STORE_ID = 'org.coworkerz.activation-demo';
export const MODEL_PARENT = '/apps';
export const MODEL_ROOT = '/apps/store';
const HOST = 'crash-matrix-host';

// Every role is a separate process with a fixed pid. A process sees only itself as
// alive, so a lock left by a crashed predecessor is provably stale. Temporary names are
// derived from (pid, counter): identical operation prefixes produce identical states,
// which lets equal crash states from different crash points be evaluated once.
const ROLE_PIDS = Object.freeze({
  setup: 1_001,
  operation: 2_001,
  recovery: 3_001,
  'recovery-retry': 3_002,
  'post-recovery': 3_003,
  reconcile: 4_001,
  observer: 5_001,
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function processFor(role) {
  const pid = ROLE_PIDS[role];
  if (pid === undefined) throw new Error(`unknown role ${role}`);
  let counter = 0;
  return {
    processProbe: { pid, hostname: HOST, isAlive: (candidate) => candidate === pid },
    randomHex: () => {
      counter += 1;
      return sha256(`${pid}:${counter}`).slice(0, 32);
    },
  };
}

function environment(io, root, role) {
  const processIdentity = processFor(role);
  return {
    io,
    root,
    open: ({ create = false } = {}) => openActivationStore({
      root,
      storeId: STORE_ID,
      io,
      create,
      ...processIdentity,
    }),
  };
}

function resource(path, mediaType, text) {
  const bytes = Buffer.from(text, 'utf8');
  return { path, mediaType, digest: sha256(bytes), size: bytes.length, bytes };
}

function blob(text) {
  const bytes = Buffer.from(text, 'utf8');
  return { digest: sha256(bytes), size: bytes.length, bytes };
}

// Deterministic fixture versions: two resources change per version, one is shared by
// every version (deduplicated object) and one asset path is version-specific.
export function versionInput(n) {
  return {
    appVersion: `1.0.${n}`,
    packageDigest: sha256(Buffer.from(`package-${n}`, 'utf8')),
    resources: [
      resource('index.html', 'text/html;charset=utf-8', `<!doctype html><title>v${n}</title>\n`),
      resource('app.js', 'text/javascript;charset=utf-8', `export const version = ${n};\n`),
      resource('shared/lib.js', 'text/javascript;charset=utf-8', 'export const shared = true;\n'),
      resource(`assets/v${n}.txt`, 'text/plain;charset=utf-8', `asset ${n}\n`),
    ],
    bindings: { 'package/manifest': blob(`manifest ${n}\n`) },
  };
}

const METADATA_T1 = { 'update/timestamp': blob('timestamp v1\n') };
const METADATA_T2 = { 'update/snapshot': blob('snapshot v2\n'), 'update/timestamp': blob('timestamp v2\n') };

async function stagedId(store, n) {
  return (await store.stageVersion(versionInput(n))).versionId;
}

async function install(store, n) {
  const { generation } = await store.status();
  const versionId = await stagedId(store, n);
  return store.activate(versionId, { expectedGeneration: generation });
}

async function ensureActive(store, n) {
  const status = await store.status();
  const versionId = await stagedId(store, n);
  if (status.active !== versionId) await store.activate(versionId, { expectedGeneration: status.generation });
}

// Activates a version that is already staged, by a process that never staged it.
async function activateStaged(env, n) {
  const store = await env.open();
  const { generation } = await store.status();
  const versionId = sha256(canonicalVersionBytes(n));
  await store.activate(versionId, { expectedGeneration: generation });
}

function canonicalVersionBytes(n) {
  const input = versionInput(n);
  return canonicalBytes({
    schema: ACTIVATION_SCHEMA.version,
    storeId: STORE_ID,
    appVersion: input.appVersion,
    packageDigest: input.packageDigest,
    resources: input.resources
      .map(({ path, mediaType, digest, size }) => ({ path, mediaType, digest, size }))
      .sort((left, right) => (left.path < right.path ? -1 : 1)),
    bindings: Object.fromEntries(Object.entries(input.bindings).map(([name, { digest, size }]) => [name, { digest, size }])),
  });
}

function bindingKey(bindings) {
  return Object.entries(bindings).sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([name, entry]) => `${name}=${entry.digest}`).join(',');
}

export const SCENARIOS = Object.freeze([
  {
    name: 'create-store',
    description: 'initialise an empty store (directories, then marker)',
    recoverWithCreate: true,
    allowedAfterRecovery: ['new'],
    async setup() {},
    async operation(env) {
      await env.open({ create: true });
    },
    async reconcile() {},
  },
  {
    name: 'first-install',
    description: 'stage and activate v1 in an empty store',
    async setup(env) {
      await env.open({ create: true });
    },
    async operation(env) {
      await install(await env.open(), 1);
    },
    async reconcile(store) {
      await ensureActive(store, 1);
    },
  },
  {
    name: 'update',
    description: 'stage and activate v2 over v1 (v1 becomes last-good)',
    async setup(env) {
      await install(await env.open({ create: true }), 1);
    },
    async operation(env) {
      await install(await env.open(), 2);
    },
    async reconcile(store) {
      await ensureActive(store, 2);
    },
  },
  {
    name: 'update-with-gc',
    description: 'activate v3 over v2 and v1; v1-only objects are collected after the commit',
    async setup(env) {
      const store = await env.open({ create: true });
      await install(store, 1);
      await install(store, 2);
    },
    async operation(env) {
      await install(await env.open(), 3);
    },
    async reconcile(store) {
      await ensureActive(store, 3);
    },
  },
  {
    name: 'rollback',
    description: 'roll back from v2 to last-good v1 (v2 becomes last-good)',
    async setup(env) {
      const store = await env.open({ create: true });
      await install(store, 1);
      await install(store, 2);
    },
    async operation(env) {
      const store = await env.open();
      const { generation } = await store.status();
      await store.rollback({ expectedGeneration: generation });
    },
    async reconcile(store) {
      const status = await store.status();
      if (status.active !== await stagedId(store, 1)) await store.rollback({ expectedGeneration: status.generation });
    },
  },
  {
    name: 'activate-staged',
    description: 'activate a version staged earlier by another process (no staging in the operation)',
    async setup(env) {
      await stagedId(await env.open({ create: true }), 1);
    },
    async operation(env) {
      await activateStaged(env, 1);
    },
    async reconcile(store) {
      await ensureActive(store, 1);
    },
  },
  {
    name: 'activate-after-unsynced-staging',
    description: 'activate a version whose objects are visible but whose staging never synced their directories',
    async setup(env) {
      await env.open({ create: true });
    },
    // After the durable checkpoint, a staging process acknowledged every
    // object-directory sync without doing it: the objects and the version record are
    // visible, nothing under objects/ is durable.
    unsyncedSetup: {
      io: (io) => createLyingIo(io, { skipDirectorySync: (path) => path.includes('/objects') }),
      async run(env) {
        await stagedId(await env.open(), 1);
      },
    },
    async operation(env) {
      await activateStaged(env, 1);
    },
    async reconcile(store) {
      await ensureActive(store, 1);
    },
  },
  {
    name: 'bind-metadata',
    description: 'replace commit-level update metadata atomically with the active pointer',
    async setup(env) {
      const store = await env.open({ create: true });
      await install(store, 1);
      await store.commitBindings(METADATA_T1, { expectedGeneration: 1 });
    },
    async operation(env) {
      const store = await env.open();
      const { generation } = await store.status();
      await store.commitBindings(METADATA_T2, { expectedGeneration: generation });
    },
    async reconcile(store) {
      const status = await store.status();
      if (bindingKey(status.bindings) !== bindingKey(METADATA_T2)) {
        await store.commitBindings(METADATA_T2, { expectedGeneration: status.generation });
      }
    },
  },
]);

export const NEGATIVE_CONTROLS = Object.freeze([
  {
    name: 'unsynced-object-directories',
    description: 'object directory fsync acknowledged but not performed',
    scenario: 'update',
    lie: { skipDirectorySync: (path) => path.includes('/objects') },
  },
  {
    name: 'unsynced-file-contents',
    description: 'file fsync acknowledged but not performed',
    scenario: 'update',
    lie: { skipFileSync: true },
  },
  {
    name: 'unsynced-commit-directory',
    description: 'commit directory fsync acknowledged but not performed before collection',
    scenario: 'update-with-gc',
    lie: { skipDirectorySync: (path) => path.endsWith('/state') },
  },
  {
    name: 'unsynced-published-file',
    description: 'post-rename file fsync of CURRENT acknowledged but not performed (the only barrier without directory sync)',
    scenario: 'update',
    variant: 'no-directory-sync',
    lie: { skipPublishedSync: (path) => path.endsWith('/state/CURRENT') },
  },
]);

// `barrier` names the call after the publishing rename that makes it durable in the
// variant's durable models: the directory sync on POSIX, the file sync where
// directories cannot be flushed and file flushes are journal barriers (the NTFS
// hypothesis). The last variant claims nothing and only checks consistency.
export const VARIANTS = Object.freeze([
  {
    name: 'directory-sync',
    directorySync: true,
    fileSyncBarrier: false,
    barrier: 'directory',
    models: ['process-crash', 'posix-strict', 'ordered-prefix'],
    durable: new Set(['posix-strict', 'ordered-prefix']),
  },
  {
    name: 'no-directory-sync',
    directorySync: false,
    fileSyncBarrier: true,
    barrier: 'file',
    models: ['process-crash', 'ordered-prefix'],
    durable: new Set(['ordered-prefix']),
  },
  {
    name: 'no-barrier',
    directorySync: false,
    fileSyncBarrier: false,
    barrier: null,
    models: ['process-crash', 'ordered-prefix'],
    durable: new Set(),
  },
]);

// ------------------------------------------------------------------------ checks

function tupleOf(status) {
  return JSON.stringify({
    generation: status.generation,
    active: status.active,
    previous: status.previous,
    bindings: bindingKey(status.bindings),
  });
}

async function observe(io, root) {
  let store;
  try {
    store = await environment(io, root, 'observer').open();
  } catch (error) {
    if (error?.code === 'STORE_NOT_INITIALIZED') return 'absent';
    throw error;
  }
  return tupleOf(await store.status());
}

async function hygiene(io, root) {
  const out = [];
  if ((await io.readdir(io.join(root, 'tmp'))).length > 0) out.push('temporary-files-left');
  const state = await io.readdir(io.join(root, 'state'));
  if (state.includes('LOCK')) out.push('lock-left');
  if (state.some((name) => name.startsWith('.tmp-'))) out.push('commit-temporary-left');
  if ((await io.readdir(root)).some((name) => name.startsWith('.tmp-'))) out.push('marker-temporary-left');
  return out;
}

async function listObjects(io, root) {
  const out = new Set();
  const objects = io.join(root, 'objects');
  for (const fanout of await io.readdir(objects)) {
    for (const name of await io.readdir(io.join(objects, fanout))) out.add(fanout + name);
  }
  return out;
}

async function reachableObjects(store, status) {
  const out = new Set(Object.values(status.bindings).map((entry) => entry.digest));
  for (const versionId of [status.active, status.previous]) {
    if (versionId === null) continue;
    const record = await store.readVersion(versionId);
    out.add(versionId);
    for (const entry of record.resources) out.add(entry.digest);
    for (const entry of Object.values(record.bindings)) out.add(entry.digest);
  }
  return out;
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function describe(error) {
  return error?.code ?? error?.message ?? String(error);
}

async function recoverAndCheck(io, root, role, scenario, expected) {
  const violations = [];
  let store;
  let report;
  try {
    store = await environment(io, root, role).open({ create: scenario.recoverWithCreate === true });
    report = await store.recover();
  } catch (error) {
    return { violations: [`recover-failed:${describe(error)}`], tuple: null };
  }
  const tuple = tupleOf(await store.status());
  const allowed = (scenario.allowedAfterRecovery ?? ['old', 'new']).map((key) => expected[key]);
  if (!allowed.includes(tuple)) violations.push('state-not-old-or-new');
  if (report.activeValid === false) violations.push('active-invalid');
  if (report.previousValid === false) violations.push('last-good-invalid');
  if (report.bindingsValid === false) violations.push('bindings-invalid');
  if (report.gc?.skipped) violations.push('gc-skipped');
  if (report.gc?.error) violations.push(`gc-error:${report.gc.error.code}`);
  violations.push(...await hygiene(io, root));
  return { violations, tuple };
}

async function reconcileAndCheck(io, root, scenario, expected) {
  const violations = [];
  try {
    const store = await environment(io, root, 'reconcile').open({ create: scenario.recoverWithCreate === true });
    await scenario.reconcile(store);
    const status = await store.status();
    if (tupleOf(status) !== expected.new) violations.push('reconcile-missed-new-state');
    for (const versionId of [status.active, status.previous]) {
      if (versionId !== null && !(await store.verifyVersion(versionId)).ok) violations.push('reconciled-version-invalid');
    }
    await store.collectGarbage();
    if (!sameSet(await listObjects(io, root), await reachableObjects(store, status))) {
      violations.push('object-set-not-exactly-reachable');
    }
    violations.push(...await hygiene(io, root));
  } catch (error) {
    violations.push(`reconcile-failed:${describe(error)}`);
  }
  return violations;
}

// Index of the trace entry after which the operation's effect must survive a power
// loss: the variant's barrier call that follows the publishing rename. Independently
// of the trace, an operation that returned has committed durably (see `committedAt`).
function durablePoint(trace, root, barrier) {
  if (barrier === null) return null;
  const commitIndex = trace.findLastIndex((entry) => entry.kind === 'rename'
    && (entry.path.endsWith(`${root}/state/CURRENT`) || entry.path.endsWith(`${root}/STORE`)));
  if (commitIndex < 0) return null;
  const marker = trace[commitIndex].path.endsWith('/STORE');
  const expected = barrier === 'directory'
    ? { kind: 'syncDir', path: marker ? root : `${root}/state` }
    : { kind: 'syncFile', path: marker ? `${root}/STORE` : `${root}/state/CURRENT` };
  const syncIndex = trace.findIndex((entry, index) => index > commitIndex
    && entry.kind === expected.kind && entry.path === expected.path);
  return syncIndex < 0 ? null : syncIndex;
}

// Whether the new state must be durable when the operation was interrupted before
// its `crashAt`-th mutating call. `crashAt === mutations + 1` is the uninterrupted
// run: whatever the trace shows, a returned operation has committed durably.
function committedAt(base, crashAt) {
  if (crashAt === base.mutations + 1) return base.expected.new !== base.expected.old;
  return base.durableAt !== null && base.durableAt <= crashAt - 2;
}

function counter() {
  return { crashCases: 0, distinctStates: 0, consistent: 0, violationCount: 0, examples: [] };
}

function record(target, violations, context) {
  target.crashCases += 1;
  if (violations.length === 0) {
    target.consistent += 1;
    return;
  }
  target.violationCount += 1;
  if (target.examples.length < 5) target.examples.push({ ...context, violations });
}

// --------------------------------------------------------------------- model runs

// Setup that must stay visible but not durable (a predecessor whose barriers never
// ran); it runs after the durable checkpoint, through the scenario's own io wrapper.
async function runUnsyncedSetup(scenario, io, root) {
  const unsynced = scenario.unsyncedSetup;
  if (unsynced === undefined) return;
  await unsynced.run(environment(unsynced.io(io), root, 'setup'));
}

async function prepareModel(variant, scenario, wrap) {
  const machine = new ModelFs({ directorySync: variant.directorySync, fileSyncBarrier: variant.fileSyncBarrier });
  await machine.io().mkdir(MODEL_PARENT);
  await scenario.setup(environment(machine.io(), MODEL_ROOT, 'setup'));
  machine.checkpoint();
  await runUnsyncedSetup(scenario, machine.io(), MODEL_ROOT);
  const old = await observe(machine.io(), MODEL_ROOT);
  const run = machine.clone();
  const crashing = createCrashingIo(wrap(run.io()));
  await scenario.operation(environment(crashing.io, MODEL_ROOT, 'operation'));
  return {
    machine,
    expected: { old, new: await observe(run.io(), MODEL_ROOT) },
    mutations: crashing.trace.length,
    durableAt: durablePoint(crashing.trace, MODEL_ROOT, variant.barrier),
  };
}

async function crashOperation(base, scenario, crashAt, wrap) {
  const machine = base.machine.clone();
  const crashing = createCrashingIo(wrap(machine.io()), { crashAt });
  try {
    await scenario.operation(environment(crashing.io, MODEL_ROOT, 'operation'));
  } catch (error) {
    if (!(error instanceof SimulatedCrash)) return { machine, error };
  }
  return { machine, error: null };
}

function statesFor(model, machine, { samples, seed }) {
  if (model === 'process-crash') return [machine.processCrashState()];
  if (model === 'posix-strict') return machine.posixStrictStates({ samples, seed });
  if (model === 'ordered-prefix') return machine.orderedPrefixStates();
  throw new Error(`unknown model ${model}`);
}

// Crash inside recovery at each of its mutating calls, then recover again.
async function checkRecoveryCrashes(crashed, scenario, expected, target, context) {
  const create = scenario.recoverWithCreate === true;
  const counting = createCrashingIo(crashed.clone().io());
  await (await environment(counting.io, MODEL_ROOT, 'recovery').open({ create })).recover();
  for (let point = 1; point <= counting.trace.length; point += 1) {
    const attempt = crashed.clone();
    const crashing = createCrashingIo(attempt.io(), { crashAt: point });
    try {
      await (await environment(crashing.io, MODEL_ROOT, 'recovery').open({ create })).recover();
    } catch (error) {
      if (!(error instanceof SimulatedCrash)) {
        record(target, [`recovery-threw:${describe(error)}`], { ...context, recoveryCrashAt: point });
        continue;
      }
    }
    target.distinctStates += 1;
    const result = await recoverAndCheck(attempt.io(), MODEL_ROOT, 'recovery-retry', scenario, expected);
    const violations = [...result.violations];
    if (violations.length === 0) violations.push(...await reconcileAndCheck(attempt.io(), MODEL_ROOT, scenario, expected));
    record(target, violations, { ...context, recoveryCrashAt: point });
  }
}

// Power loss after a completed recovery: the state recovery made visible must stay.
async function checkPostRecoveryPowerLoss(recovered, recoveredTuple, scenario, expected, variant, targets, context, options) {
  for (const model of variant.models.filter((name) => name !== 'process-crash')) {
    const target = targets[`post-recovery-power-loss/${model}`];
    for (const state of statesFor(model, recovered, options)) {
      const fingerprint = state.fingerprint();
      let violations = target.cache.get(fingerprint);
      if (violations === undefined) {
        target.counter.distinctStates += 1;
        const before = await observe(state.io(), MODEL_ROOT);
        violations = [];
        if (variant.durable.has(model) && before !== recoveredTuple) violations.push('recovery-barrier-lost');
        violations.push(...(await recoverAndCheck(state.io(), MODEL_ROOT, 'post-recovery', scenario, expected)).violations);
        target.cache.set(fingerprint, violations);
      }
      record(target.counter, violations, context);
    }
  }
}

export async function runModelMatrix({
  variants = VARIANTS,
  scenarios = SCENARIOS,
  samples = 12,
  postRecoverySamples = 4,
  seed = 20260927,
  nested = true,
} = {}) {
  const results = [];
  for (const variant of variants) {
    for (const scenario of scenarios) {
      const base = await prepareModel(variant, scenario, (io) => io);
      const names = [...variant.models];
      if (nested) {
        names.push('recovery-crash');
        for (const model of variant.models) if (model !== 'process-crash') names.push(`post-recovery-power-loss/${model}`);
      }
      const targets = Object.fromEntries(names.map((name) => [name, { counter: counter(), cache: new Map() }]));
      let durabilityViolations = 0;

      for (let crashAt = 1; crashAt <= base.mutations + 1; crashAt += 1) {
        const { machine, error } = await crashOperation(base, scenario, crashAt, (io) => io);
        if (error) {
          record(targets['process-crash'].counter, [`operation-threw:${describe(error)}`], { crashAt });
          continue;
        }
        const committed = committedAt(base, crashAt);

        for (const model of variant.models) {
          const target = targets[model];
          for (const state of statesFor(model, machine, { samples, seed: seed + crashAt })) {
            const context = { crashAt, model };
            if (model === 'process-crash') {
              target.counter.distinctStates += 1;
              const result = await recoverAndCheck(state.io(), MODEL_ROOT, 'recovery', scenario, base.expected);
              const violations = [...result.violations];
              if (violations.length === 0) {
                const retry = state.clone();
                violations.push(...await reconcileAndCheck(retry.io(), MODEL_ROOT, scenario, base.expected));
              }
              record(target.counter, violations, context);
              if (nested && result.violations.length === 0) {
                await checkRecoveryCrashes(machine.processCrashState(), scenario, base.expected, targets['recovery-crash'].counter, context);
                await checkPostRecoveryPowerLoss(state, result.tuple, scenario, base.expected, variant, targets, context, {
                  samples: postRecoverySamples,
                  seed: seed + crashAt,
                });
              }
              continue;
            }

            const fingerprint = state.fingerprint();
            let cached = target.cache.get(fingerprint);
            if (cached === undefined) {
              target.counter.distinctStates += 1;
              const before = await observe(state.io(), MODEL_ROOT);
              const result = await recoverAndCheck(state.io(), MODEL_ROOT, 'recovery', scenario, base.expected);
              const violations = [...result.violations];
              if (violations.length === 0) violations.push(...await reconcileAndCheck(state.io(), MODEL_ROOT, scenario, base.expected));
              cached = { before, violations };
              target.cache.set(fingerprint, cached);
            }
            const violations = [...cached.violations];
            if (committed && variant.durable.has(model) && cached.before !== base.expected.new) {
              violations.push('committed-state-lost');
              durabilityViolations += 1;
            }
            record(target.counter, violations, context);
          }
        }
      }
      results.push({
        variant: variant.name,
        scenario: scenario.name,
        description: scenario.description,
        mutatingOperations: base.mutations,
        crashPoints: base.mutations + 1,
        durablePoint: base.durableAt,
        durabilityViolations,
        models: Object.fromEntries(Object.entries(targets).map(([name, target]) => [name, target.counter])),
      });
    }
  }
  return results;
}

export async function runNegativeControls({ controls = NEGATIVE_CONTROLS, samples = 12, seed = 20260927 } = {}) {
  const results = [];
  for (const control of controls) {
    const variant = VARIANTS.find((candidate) => candidate.name === (control.variant ?? 'directory-sync'));
    const scenario = SCENARIOS.find((candidate) => candidate.name === control.scenario);
    const wrap = (io) => createLyingIo(io, control.lie);
    const base = await prepareModel(variant, scenario, wrap);
    const models = {};
    for (const model of variant.models.filter((name) => name !== 'process-crash')) {
      const target = counter();
      const cache = new Map();
      for (let crashAt = 1; crashAt <= base.mutations + 1; crashAt += 1) {
        const { machine, error } = await crashOperation(base, scenario, crashAt, wrap);
        if (error) throw error;
        const committed = committedAt(base, crashAt);
        for (const state of statesFor(model, machine, { samples, seed: seed + crashAt })) {
          const fingerprint = state.fingerprint();
          let cached = cache.get(fingerprint);
          if (cached === undefined) {
            target.distinctStates += 1;
            const before = await observe(state.io(), MODEL_ROOT).catch((failure) => `observe-failed:${describe(failure)}`);
            const { violations } = await recoverAndCheck(state.io(), MODEL_ROOT, 'recovery', scenario, base.expected);
            cached = { before, violations };
            cache.set(fingerprint, cached);
          }
          const violations = [...cached.violations];
          if (committed && cached.before !== base.expected.new) violations.push('committed-state-lost');
          record(target, violations, { crashAt, model });
        }
      }
      models[model] = target;
    }
    results.push({
      name: control.name,
      description: control.description,
      scenario: control.scenario,
      variant: variant.name,
      models,
      discriminating: Object.values(models).some((target) => target.violationCount > 0),
    });
  }
  return results;
}

// ------------------------------------------------------------------- real files

// Process crashes against the real filesystem through the Node adapter. The setup
// state is built once and copied per crash point; recovery runs in a new process.
export async function runRealFsProcessCrashMatrix({ scenarios = SCENARIOS, baseDirectory = tmpdir() } = {}) {
  const io = createNodeIo();
  const workspace = await mkdtemp(join(baseDirectory, 'activation-crash-matrix-'));
  const results = [];
  try {
    for (const scenario of scenarios) {
      const template = join(workspace, `${scenario.name}-template`);
      await io.mkdir(template, 0o700);
      await io.mkdir(join(template, 'apps'), 0o700);
      const templateRoot = join(template, 'apps', 'store');
      await scenario.setup(environment(io, templateRoot, 'setup'));
      await runUnsyncedSetup(scenario, io, templateRoot);
      const old = await observe(io, templateRoot);

      const baselineDirectory = join(workspace, `${scenario.name}-baseline`);
      await cp(template, baselineDirectory, { recursive: true });
      const baselineRoot = join(baselineDirectory, 'apps', 'store');
      const counting = createCrashingIo(io);
      await scenario.operation(environment(counting.io, baselineRoot, 'operation'));
      const expected = { old, new: await observe(io, baselineRoot) };
      const mutations = counting.trace.length;

      const target = counter();
      for (let crashAt = 1; crashAt <= mutations + 1; crashAt += 1) {
        const attemptDirectory = join(workspace, `${scenario.name}-${crashAt}`);
        await cp(template, attemptDirectory, { recursive: true });
        const root = join(attemptDirectory, 'apps', 'store');
        const crashing = createCrashingIo(io, { crashAt });
        try {
          await scenario.operation(environment(crashing.io, root, 'operation'));
        } catch (error) {
          if (!(error instanceof SimulatedCrash)) {
            record(target, [`operation-threw:${describe(error)}`], { crashAt });
            continue;
          }
        }
        target.distinctStates += 1;
        const result = await recoverAndCheck(io, root, 'recovery', scenario, expected);
        const violations = [...result.violations];
        if (violations.length === 0) violations.push(...await reconcileAndCheck(io, root, scenario, expected));
        record(target, violations, { crashAt, model: 'process-crash/real-fs' });
        await rm(attemptDirectory, { recursive: true, force: true });
      }
      results.push({ scenario: scenario.name, mutatingOperations: mutations, crashPoints: mutations + 1, processCrash: target });
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
  return results;
}

export function summarize(modelResults, negativeControls, realFsResults = null) {
  let crashCases = 0;
  let consistent = 0;
  let durabilityViolations = 0;
  for (const result of modelResults) {
    durabilityViolations += result.durabilityViolations;
    for (const target of Object.values(result.models)) {
      crashCases += target.crashCases;
      consistent += target.consistent;
    }
  }
  const real = (realFsResults ?? []).reduce((sum, result) => ({
    crashCases: sum.crashCases + result.processCrash.crashCases,
    consistent: sum.consistent + result.processCrash.consistent,
  }), { crashCases: 0, consistent: 0 });
  return {
    modelCrashCases: crashCases,
    modelConsistent: consistent,
    modelRecoverySuccess: crashCases === 0 ? null : consistent / crashCases,
    durabilityViolations,
    negativeControlsDiscriminating: `${negativeControls.filter((control) => control.discriminating).length}/${negativeControls.length}`,
    realFsCrashCases: realFsResults === null ? null : real.crashCases,
    realFsConsistent: realFsResults === null ? null : real.consistent,
  };
}
