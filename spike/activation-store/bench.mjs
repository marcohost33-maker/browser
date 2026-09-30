#!/usr/bin/env node
// Latency and peak-memory benchmark for the activation store (ADR-007a section 9:
// "p50/p95 verification time and peak memory by package size").
//
//   node spike/activation-store/bench.mjs                      # default profiles, Markdown table
//   node spike/activation-store/bench.mjs --ci                 # the bounded set the CI job runs
//   node spike/activation-store/bench.mjs --full               # adds the 512 MiB envelope profile
//   node spike/activation-store/bench.mjs --profile small,medium --iterations 5 \
//        --json results/bench.json --dir /mnt/real-disk
//
// Every profile runs in its own child process so that the peak resident set is the
// profile's own. Contents are generated deterministically from a seed and streamed
// into the store, so the package never resides in memory and the measured peak is
// what the store itself allocates. Numbers are host-dependent: the report carries
// the environment and is evidence for that host only.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { openActivationStore } from './activation-store.js';

export const BENCH_SCHEMA = 'browser-activation/bench-report/v1';
export const STORE_ID = 'org.coworkerz.activation-bench';
const CHUNK_BYTES = 256 * 1024;
const READS_PER_ITERATION = 100;
// Streamed reads hash the whole object before the first byte; bound the bytes per
// iteration so large profiles do not spend their time re-reading one object.
const STREAM_BYTES_PER_ITERATION = 64 * 1024 * 1024;
const MEMORY_SAMPLE_MS = 25;
const MiB = 1024 * 1024;

// Package shapes along the ADR-007a resource envelope: a small app, a typical app, a
// large app, the per-object limit (64 MiB), the resource-count limit (10,000) and the
// aggregate limit (512 MiB). `ci` marks the bounded set the CI job runs.
export const PROFILES = Object.freeze({
  small: { resources: 50, bytes: 4 * 1024, iterations: 5, ci: true },
  medium: { resources: 500, bytes: 32 * 1024, iterations: 3, ci: true },
  large: { resources: 2_000, bytes: 64 * 1024, iterations: 2, ci: false },
  'big-object': { resources: 1, bytes: 64 * MiB, iterations: 3, ci: true },
  'many-tiny': { resources: 10_000, bytes: 256, iterations: 1, ci: true },
  envelope: { resources: 8, bytes: 64 * MiB, iterations: 1, ci: false, full: true },
});

// ------------------------------------------------------------------ generation

function xorshift32(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

// Deterministic pseudo-random content, produced chunk by chunk.
export function* contentChunks(seed, bytes) {
  const next = xorshift32(seed);
  let remaining = bytes;
  while (remaining > 0) {
    const size = Math.min(remaining, CHUNK_BYTES);
    const chunk = Buffer.allocUnsafe(size);
    const words = new Uint32Array(chunk.buffer, chunk.byteOffset, size >>> 2);
    for (let index = 0; index < words.length; index += 1) words[index] = next();
    for (let index = words.length * 4; index < size; index += 1) chunk[index] = next() & 0xff;
    remaining -= size;
    yield chunk;
  }
}

function digestOf(seed, bytes) {
  const hash = createHash('sha256');
  for (const chunk of contentChunks(seed, bytes)) hash.update(chunk);
  return hash.digest('hex');
}

function resourcePath(index) {
  return `assets/${(index % 128).toString(16).padStart(2, '0')}/r${index}.bin`;
}

// Declared digests are computed once per profile; every staging gets fresh generators.
export function planPackage(name, spec) {
  const seedBase = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const resources = Array.from({ length: spec.resources }, (_, index) => ({
    path: resourcePath(index),
    seed: (seedBase + index * 2654435761) >>> 0,
    size: spec.bytes,
    digest: digestOf((seedBase + index * 2654435761) >>> 0, spec.bytes),
  }));
  const manifest = Buffer.from(`bench manifest ${name} ${spec.resources}x${spec.bytes}\n`, 'utf8');
  return {
    resources,
    manifest,
    totalBytes: spec.resources * spec.bytes,
    input: () => ({
      appVersion: `bench-${name}`,
      packageDigest: createHash('sha256').update(`package-${name}`).digest('hex'),
      resources: resources.map((entry) => ({
        path: entry.path,
        mediaType: 'application/octet-stream',
        digest: entry.digest,
        size: entry.size,
        chunks: contentChunks(entry.seed, entry.size),
      })),
      bindings: {
        'package/manifest': {
          digest: createHash('sha256').update(manifest).digest('hex'),
          size: manifest.length,
          bytes: manifest,
        },
      },
    }),
  };
}

// ------------------------------------------------------------------ statistics

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank];
}

function summarise(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const round = (value) => (value === null ? null : Math.round(value * 100) / 100);
  return {
    n: sorted.length,
    min: round(sorted[0] ?? null),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted[sorted.length - 1] ?? null),
    mean: round(sorted.length === 0 ? null : sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
  };
}

function throughput(totalBytes, milliseconds) {
  if (!milliseconds) return null;
  return Math.round((totalBytes / MiB) / (milliseconds / 1000) * 10) / 10;
}

// ------------------------------------------------------------------ one profile

// Runs `iterations` fresh stores for one profile and reports latency samples per
// operation plus the process's peak memory. Meant to run in a child process.
export async function runProfile(name, spec, { iterations = spec.iterations, directory = tmpdir(), reads = READS_PER_ITERATION } = {}) {
  const plan = planPackage(name, spec);
  const samples = { stage: [], activate: [], verify: [], read: [], open: [], stream: [], recover: [], restage: [] };
  const streamReads = Math.max(1, Math.min(reads, Math.floor(STREAM_BYTES_PER_ITERATION / Math.max(spec.bytes, 1))));
  const baseline = process.memoryUsage();
  const peak = { rss: baseline.rss, heapUsed: baseline.heapUsed, arrayBuffers: baseline.arrayBuffers };
  // Peak memory is also attributed to the operation running at sampling time, so the
  // whole-object read path and the streaming path can be told apart.
  const byPhase = {};
  let current = null;
  const observe = () => {
    const usage = process.memoryUsage();
    peak.rss = Math.max(peak.rss, usage.rss);
    peak.heapUsed = Math.max(peak.heapUsed, usage.heapUsed);
    peak.arrayBuffers = Math.max(peak.arrayBuffers, usage.arrayBuffers);
    if (current !== null) {
      const slot = byPhase[current];
      slot.rss = Math.max(slot.rss, usage.rss);
      slot.arrayBuffers = Math.max(slot.arrayBuffers, usage.arrayBuffers);
    }
  };
  const phase = async (name, operation) => {
    byPhase[name] ??= { rss: 0, arrayBuffers: 0 };
    // Garbage from the previous phase must not be attributed to this one; the child
    // runs with --expose-gc so a collection can be forced at the boundary.
    globalThis.gc?.();
    current = name;
    observe();
    try {
      return await operation();
    } finally {
      observe();
      current = null;
    }
  };
  const sampler = setInterval(observe, MEMORY_SAMPLE_MS);
  sampler.unref();
  const pick = xorshift32(0xbe9c);
  let commitBarrier = null;

  try {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const workspace = await mkdtemp(path.join(directory, `activation-bench-${name}-`));
      try {
        const store = await openActivationStore({ root: path.join(workspace, 'store'), storeId: STORE_ID, create: true });

        let started = performance.now();
        const { versionId } = await phase('stage', () => store.stageVersion(plan.input()));
        samples.stage.push(performance.now() - started);

        started = performance.now();
        const activated = await phase('activate', () => store.activate(versionId, { expectedGeneration: 0 }));
        samples.activate.push(performance.now() - started);
        commitBarrier = activated.commitBarrier;

        started = performance.now();
        const check = await phase('verify', () => store.verifyVersion(versionId));
        samples.verify.push(performance.now() - started);
        if (!check.ok) throw new Error(`verification failed: ${JSON.stringify(check.problems.slice(0, 3))}`);

        await phase('read', async () => {
          for (let count = 0; count < Math.min(reads, plan.resources.length); count += 1) {
            const entry = plan.resources[pick() % plan.resources.length];
            started = performance.now();
            const read = await store.readResource(entry.path);
            samples.read.push(performance.now() - started);
            if (read.size !== entry.size) throw new Error(`read size mismatch for ${entry.path}`);
          }
        });

        // Streamed serving: `open` is the time to the first byte (verification of
        // the whole object included), `stream` the time to drain it in chunks.
        await phase('stream', async () => {
          for (let count = 0; count < Math.min(streamReads, plan.resources.length); count += 1) {
            const entry = plan.resources[pick() % plan.resources.length];
            started = performance.now();
            const opened = await store.openResource(entry.path);
            samples.open.push(performance.now() - started);
            started = performance.now();
            let drained = 0;
            for await (const chunk of opened.stream()) drained += chunk.length;
            samples.stream.push(performance.now() - started);
            if (drained !== entry.size) throw new Error(`stream size mismatch for ${entry.path}`);
          }
        });

        started = performance.now();
        const report = await phase('recover', () => store.recover());
        samples.recover.push(performance.now() - started);
        if (report.activeValid !== true) throw new Error('recovery found the active version invalid');

        started = performance.now();
        const again = await phase('restage', () => store.stageVersion(plan.input()));
        samples.restage.push(performance.now() - started);
        if (again.versionId !== versionId || again.objectsWritten !== 0) throw new Error('restage was not a pure reuse');
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    }
  } finally {
    clearInterval(sampler);
  }

  const usage = process.resourceUsage();
  const stage = summarise(samples.stage);
  const verify = summarise(samples.verify);
  return {
    profile: name,
    resources: spec.resources,
    bytesPerResource: spec.bytes,
    totalBytes: plan.totalBytes,
    iterations,
    readsPerIteration: Math.min(reads, plan.resources.length),
    streamReadsPerIteration: Math.min(streamReads, plan.resources.length),
    commitBarrier,
    latencyMs: {
      stage,
      activate: summarise(samples.activate),
      verify,
      read: summarise(samples.read),
      open: summarise(samples.open),
      stream: summarise(samples.stream),
      recover: summarise(samples.recover),
      restage: summarise(samples.restage),
    },
    throughputMiBps: {
      stage: throughput(plan.totalBytes, stage.p50),
      verify: throughput(plan.totalBytes, verify.p50),
      stream: throughput(spec.bytes, summarise(samples.stream).p50),
    },
    perObjectMs: { stage: Math.round((stage.p50 / spec.resources) * 1000) / 1000 },
    memoryBytes: {
      baselineRss: baseline.rss,
      peakRss: peak.rss,
      peakHeapUsed: peak.heapUsed,
      peakArrayBuffers: peak.arrayBuffers,
      maxRss: usage.maxRSS * 1024,
      byPhase,
    },
  };
}

// ------------------------------------------------------------------ orchestration

const here = fileURLToPath(import.meta.url);

function environment() {
  const [cpu] = cpus();
  return {
    platform: platform(),
    release: release(),
    arch: arch(),
    node: process.version,
    cpu: cpu?.model ?? 'unknown',
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
  };
}

async function filesystemOf(directory) {
  if (platform() !== 'linux') return 'unknown';
  try {
    const mounts = (await readFile('/proc/mounts', 'utf8')).split('\n');
    let best = { point: '', type: 'unknown' };
    for (const line of mounts) {
      const [, point, type] = line.split(' ');
      if (point && (directory === point || directory.startsWith(`${point.replace(/\/$/, '')}/`)) && point.length >= best.point.length) {
        best = { point, type };
      }
    }
    return best.type;
  } catch {
    return 'unknown';
  }
}

async function runInChild(name, iterations, directory) {
  const { stdout } = await promisify(execFile)(process.execPath, [
    '--expose-gc', here, '--child', name, '--iterations', String(iterations), '--dir', directory,
  ], { maxBuffer: 16 * MiB });
  const line = stdout.trim().split('\n').pop();
  return JSON.parse(line);
}

function formatBytes(bytes) {
  if (bytes >= MiB) return `${Math.round(bytes / MiB)} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

function pair(summary) {
  return summary.n === 0 ? '—' : `${summary.p50} / ${summary.p95}`;
}

export function markdownTable(report) {
  const lines = [
    '| Profile | Package | stage p50 / p95 ms (MiB/s) | activate p50 / p95 ms | verify p50 / p95 ms (MiB/s) | read p50 / p95 ms | open p50 / p95 ms | stream p50 ms (MiB/s) | recover p50 ms | per object (stage) | peak RSS | peak buffers read / stream |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const row of report.profiles) {
    const buffers = (name) => formatBytes(row.memoryBytes.byPhase?.[name]?.arrayBuffers ?? 0);
    lines.push(`| ${row.profile} | ${row.resources} × ${formatBytes(row.bytesPerResource)} = ${formatBytes(row.totalBytes)} `
      + `| ${pair(row.latencyMs.stage)} (${row.throughputMiBps.stage ?? '—'}) `
      + `| ${pair(row.latencyMs.activate)} `
      + `| ${pair(row.latencyMs.verify)} (${row.throughputMiBps.verify ?? '—'}) `
      + `| ${pair(row.latencyMs.read)} `
      + `| ${pair(row.latencyMs.open)} `
      + `| ${row.latencyMs.stream.p50 ?? '—'} (${row.throughputMiBps.stream ?? '—'}) `
      + `| ${row.latencyMs.recover.p50 ?? '—'} `
      + `| ${row.perObjectMs.stage} ms `
      + `| ${formatBytes(row.memoryBytes.maxRss)} `
      + `| ${buffers('read')} / ${buffers('stream')} |`);
  }
  return lines.join('\n');
}

function parseArguments(argv) {
  const options = { profiles: null, iterations: null, json: null, dir: tmpdir(), ci: false, full: false, child: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => argv[++index];
    if (argument === '--profile') options.profiles = value().split(',');
    else if (argument === '--iterations') options.iterations = Number(value());
    else if (argument === '--json') options.json = value();
    else if (argument === '--dir') options.dir = path.resolve(value());
    else if (argument === '--ci') options.ci = true;
    else if (argument === '--full') options.full = true;
    else if (argument === '--child') options.child = value();
    else throw new Error(`unknown argument ${argument}`);
  }
  return options;
}

async function main(argv) {
  const options = parseArguments(argv);
  if (options.child !== null) {
    const spec = PROFILES[options.child];
    if (!spec) throw new Error(`unknown profile ${options.child}`);
    const result = await runProfile(options.child, spec, { iterations: options.iterations ?? spec.iterations, directory: options.dir });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  const names = options.profiles
    ?? Object.entries(PROFILES)
      .filter(([, spec]) => (options.ci ? spec.ci : options.full || !spec.full))
      .map(([name]) => name);
  for (const name of names) if (!PROFILES[name]) throw new Error(`unknown profile ${name}`);

  const base = await mkdtemp(path.join(options.dir, 'activation-bench-'));
  const report = {
    schema: BENCH_SCHEMA,
    environment: { ...environment(), filesystem: await filesystemOf(base), directory: base },
    profiles: [],
  };
  try {
    for (const name of names) {
      const iterations = options.iterations ?? PROFILES[name].iterations;
      process.stderr.write(`bench ${name}: ${PROFILES[name].resources} x ${formatBytes(PROFILES[name].bytes)}, ${iterations} iteration(s)\n`);
      report.profiles.push(await runInChild(name, iterations, base));
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
  delete report.environment.directory;
  if (options.json) await writeFile(options.json, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report.environment)}\n\n${markdownTable(report)}\n`);
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === here) {
  process.exitCode = await main(process.argv.slice(2));
}
