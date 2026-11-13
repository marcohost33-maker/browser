// Keeps the ADR-007a section 9 benchmark runnable: a tiny profile in-process, the
// deterministic content generator and the report shape. Real numbers come from
// `node spike/activation-store/bench.mjs` on a real disk and from the CI job.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  contentChunks,
  markdownTable,
  planPackage,
  PROFILES,
  runProfile,
} from '../../spike/activation-store/bench.mjs';

function digest(chunks) {
  const hash = createHash('sha256');
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest('hex');
}

test('generated content is deterministic per seed, exact in length and distinct across seeds', () => {
  assert.equal(digest(contentChunks(1, 1000)), digest(contentChunks(1, 1000)));
  assert.notEqual(digest(contentChunks(1, 1000)), digest(contentChunks(2, 1000)));
  let total = 0;
  for (const chunk of contentChunks(3, 300_001)) total += chunk.length;
  assert.equal(total, 300_001);
  assert.equal([...contentChunks(4, 0)].length, 0);
});

test('a planned package declares digests that the store accepts, with fresh generators per staging', async () => {
  const plan = planPackage('probe', { resources: 6, bytes: 3 * 1024 + 7 });
  assert.equal(plan.totalBytes, 6 * (3 * 1024 + 7));
  const first = plan.input();
  const second = plan.input();
  assert.notEqual(first.resources[0].chunks, second.resources[0].chunks, 'generators are single-use');
  assert.equal(digest(first.resources[0].chunks), first.resources[0].digest);
});

test('the benchmark measures every operation of one small profile and reports peak memory', async () => {
  const result = await runProfile('smoke', { resources: 8, bytes: 2048 }, { iterations: 1, reads: 5 });
  for (const operation of ['stage', 'activate', 'verify', 'recover', 'restage']) {
    assert.equal(result.latencyMs[operation].n, 1, operation);
    assert.ok(result.latencyMs[operation].p50 >= 0, operation);
  }
  assert.equal(result.latencyMs.read.n, 5);
  assert.equal(result.latencyMs.open.n, 5);
  assert.equal(result.latencyMs.stream.n, 5);
  assert.ok(result.throughputMiBps.stream > 0);
  assert.ok(result.memoryBytes.maxRss > 0);
  assert.ok(result.memoryBytes.peakRss >= result.memoryBytes.baselineRss);
  assert.deepEqual(Object.keys(result.memoryBytes.byPhase), ['stage', 'activate', 'verify', 'read', 'stream', 'recover', 'restage']);
  assert.ok(result.memoryBytes.byPhase.stream.arrayBuffers > 0, 'every phase was sampled at least once');
  // Throughput is a presentation metric rounded to 0.1 MiB/s. A tiny 16 KiB
  // smoke package can therefore legitimately round a positive measured rate to
  // 0.0 on a slow/shared runner; null, not zero, is the "not measurable"
  // sentinel (milliseconds === 0).
  assert.notEqual(result.throughputMiBps.stage, null);
  assert.ok(result.throughputMiBps.stage >= 0);
  assert.match(result.commitBarrier, /^(directory-fsync|file-fsync-only)$/);
  const table = markdownTable({ profiles: [result] });
  assert.match(table, /\| smoke \| 8 × 2 KiB = 16 KiB \|/);
});

test('the CI profile set stays within the resource envelope of the store', () => {
  for (const [name, spec] of Object.entries(PROFILES)) {
    assert.ok(spec.resources >= 1 && spec.resources <= 10_000, name);
    assert.ok(spec.bytes >= 1 && spec.bytes <= 64 * 1024 * 1024, name);
    assert.ok(spec.resources * spec.bytes <= 512 * 1024 * 1024, name);
  }
  assert.deepEqual(
    Object.entries(PROFILES).filter(([, spec]) => spec.ci).map(([name]) => name),
    ['small', 'medium', 'big-object', 'many-tiny'],
  );
});
