// Crash-matrix scenarios for the coupled update transaction.
//
// They run through the activation store's own crash matrix (`runModelMatrix`): every
// operation is interrupted before each of its mutating filesystem calls, observed
// through the process-crash, posix-strict and ordered-prefix persistence models in
// three platform variants, recovered by a new process and reconciled. That harness
// already demands that the recovered commit is exactly the old or the new one.
//
// The scenarios add the update semantics on top. `reconcile` first checks the
// recovered state as an update client would at start-up (`verifyInstalledState`):
// the bound chain re-verifies under the bound root, the trust state is authorised by
// the bound targets metadata, and the active package is the authorised one. Only
// then does it finish the operation and check the result again. A violation throws,
// which the harness records as `reconcile-failed`.
//
// `TWO_COMMIT_CONTROL` is the negative control: the same plan, committed as metadata
// first and package second. The matrix must report it, otherwise it could not tell
// the coupled protocol from the obvious broken one.

import {
  applyOfflineUpdate,
  bootstrapUpdateTrust,
  planOfflineUpdate,
  rollbackPackage,
  UPDATE_BINDINGS,
  UpdateActivationError,
  verifyInstalledState,
} from '../update-activation.js';
import { FIXED_NOW, releaseBundle, rootBytes, TARGET_PATH } from './tuf-repository.js';

const ROOT_1 = rootBytes();
const ROOT_2 = rootBytes({ version: 2, rotateOnline: true });

export const RELEASES = Object.freeze({
  v1: releaseBundle({ appVersion: 1 }),
  v2: releaseBundle({ appVersion: 2 }),
  v2Rotated: releaseBundle({ appVersion: 2, roots: [ROOT_2], rotateOnline: true }),
  v2Refresh: releaseBundle({ appVersion: 2, timestampVersion: 3, snapshotVersion: 3 }),
});

function apply(store, bundle) {
  return applyOfflineUpdate(store, {
    bundle,
    targetPath: TARGET_PATH,
    now: FIXED_NOW,
    // Consent for the initial capability set; later releases keep the same set.
    approveCapabilityExpansion: () => true,
  });
}

function violation(message, details) {
  throw new UpdateActivationError('MATRIX_INVARIANT', message, details);
}

async function installed(store) {
  return verifyInstalledState(store);
}

// Start-up check of a recovered state, followed by the expectation of the scenario.
async function expectInstalled(store, allowed) {
  const state = await installed(store);
  const { root, timestamp, targets } = state.metadataVersions;
  const key = `${state.status}:${state.appVersion}:ts${timestamp}:t${targets}:r${root}`;
  if (!allowed.includes(key)) violation(`recovered update state ${key} is not one of ${allowed.join(', ')}`);
  return state;
}

async function hasUpdateRoot(store) {
  return (await store.status()).bindings[UPDATE_BINDINGS.root] !== undefined;
}

async function setupStore(env, releases) {
  const store = await env.open({ create: true });
  await bootstrapUpdateTrust(store, ROOT_1);
  for (const release of releases) await apply(store, release);
  return store;
}

export const COUPLED_SCENARIOS = Object.freeze([
  {
    name: 'coupled-bootstrap',
    description: 'bind the initial trusted root into an empty store',
    async setup(env) {
      await env.open({ create: true });
    },
    async operation(env) {
      await bootstrapUpdateTrust(await env.open(), ROOT_1);
    },
    async reconcile(store) {
      if (!(await hasUpdateRoot(store))) await bootstrapUpdateTrust(store, ROOT_1);
      const state = await installed(store);
      if (state.status !== 'not-installed' || state.metadataVersions.root !== 1) violation('bootstrap did not bind root v1 alone');
    },
  },
  {
    name: 'coupled-first-install',
    description: 'verify and install v1: package, metadata and trust state in one commit',
    async setup(env) {
      await setupStore(env, []);
    },
    async operation(env) {
      await apply(await env.open(), RELEASES.v1);
    },
    async reconcile(store) {
      const state = await installed(store);
      if (state.status === 'not-installed') {
        if (state.metadataVersions.targets !== 0) violation('metadata bound without its package');
        await apply(store, RELEASES.v1);
      } else if (`${state.status}:${state.appVersion}` !== 'current:1') {
        violation(`unexpected recovered state ${state.status}:${state.appVersion}`);
      }
      await expectInstalled(store, ['current:1:ts1:t1:r1']);
    },
  },
  {
    name: 'coupled-update',
    description: 'update v1 -> v2: new package and new metadata in one commit',
    async setup(env) {
      await setupStore(env, [RELEASES.v1]);
    },
    async operation(env) {
      await apply(await env.open(), RELEASES.v2);
    },
    async reconcile(store) {
      const state = await expectInstalled(store, ['current:1:ts1:t1:r1', 'current:2:ts2:t2:r1']);
      if (state.appVersion === 1) await apply(store, RELEASES.v2);
      await expectInstalled(store, ['current:2:ts2:t2:r1']);
    },
  },
  {
    name: 'coupled-update-root-rotation',
    description: 'update v1 -> v2 with root v2 rotating timestamp and snapshot keys, all in one commit',
    async setup(env) {
      await setupStore(env, [RELEASES.v1]);
    },
    async operation(env) {
      await apply(await env.open(), RELEASES.v2Rotated);
    },
    async reconcile(store) {
      const state = await expectInstalled(store, ['current:1:ts1:t1:r1', 'current:2:ts2:t2:r2']);
      if (state.appVersion === 1) await apply(store, RELEASES.v2Rotated);
      await expectInstalled(store, ['current:2:ts2:t2:r2']);
    },
  },
  {
    name: 'coupled-metadata-refresh',
    description: 'newer timestamp/snapshot for the installed v2: bindings change, the package does not',
    async setup(env) {
      await setupStore(env, [RELEASES.v1, RELEASES.v2]);
    },
    async operation(env) {
      await apply(await env.open(), RELEASES.v2Refresh);
    },
    async reconcile(store) {
      const state = await expectInstalled(store, ['current:2:ts2:t2:r1', 'current:2:ts3:t2:r1']);
      if (state.metadataVersions.timestamp === 2) {
        const result = await apply(store, RELEASES.v2Refresh);
        if (result.status !== 'metadata-updated') violation(`refresh reported ${result.status}`);
      }
      const after = await expectInstalled(store, ['current:2:ts3:t2:r1']);
      if (after.active !== state.active) violation('a metadata refresh replaced the active version');
    },
  },
  {
    name: 'coupled-rollback',
    description: 'local rollback v2 -> v1: the package moves back, metadata and rollback floors stay',
    async setup(env) {
      await setupStore(env, [RELEASES.v1, RELEASES.v2]);
    },
    async operation(env) {
      await rollbackPackage(await env.open());
    },
    async reconcile(store) {
      const state = await expectInstalled(store, ['current:2:ts2:t2:r1', 'rolled-back:1:ts2:t2:r1']);
      if (state.status === 'current') await rollbackPackage(store);
      const after = await expectInstalled(store, ['rolled-back:1:ts2:t2:r1']);
      if (after.trustedAppVersion !== 2) violation('rollback lowered the trusted app version');
    },
  },
]);

/**
 * Negative control: the verified plan committed in TWO commits (metadata, then
 * package). A crash between them leaves new metadata next to the old package: a
 * commit that is neither the old nor the new state. `reconcile` finishes with the
 * same two-commit protocol, so generation counting cannot produce a spurious
 * difference and every reported violation is about the state itself.
 */
async function twoCommitApply(store, bundle) {
  const plan = await planOfflineUpdate(store, {
    bundle,
    targetPath: TARGET_PATH,
    now: FIXED_NOW,
    approveCapabilityExpansion: () => true,
  });
  const bound = await store.commitBindings(plan.bindings, { expectedGeneration: plan.state.generation });
  const { versionId } = await store.stageVersion(plan.stage);
  await store.activate(versionId, { expectedGeneration: bound.generation });
}

export const TWO_COMMIT_CONTROL = Object.freeze({
  name: 'two-commit-update',
  description: 'negative control: the coupled-update plan, but metadata and package in separate commits',
  async setup(env) {
    await setupStore(env, [RELEASES.v1]);
  },
  async operation(env) {
    await twoCommitApply(await env.open(), RELEASES.v2);
  },
  async reconcile(store) {
    const state = await expectInstalled(store, ['current:1:ts1:t1:r1', 'current:2:ts2:t2:r1']);
    if (state.appVersion === 1) await twoCommitApply(store, RELEASES.v2);
    await expectInstalled(store, ['current:2:ts2:t2:r1']);
  },
});
