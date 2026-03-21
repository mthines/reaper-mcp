/**
 * Integration stress tests for the Lua bridge.
 *
 * These tests require a running REAPER instance with the mcp_bridge.lua script active.
 * They are automatically skipped when the bridge is not detected.
 *
 * Run specifically with:
 *   pnpm vitest run apps/reaper-mcp-server/src/bridge.stress.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { sendCommand, isBridgeRunning } from './bridge.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  failures: number;
}

function computeStats(durations: number[], failures: number): LatencyStats {
  const sorted = [...durations].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count,
    min: sorted[0] ?? 0,
    max: sorted[count - 1] ?? 0,
    mean: Math.round(sum / count),
    p50: sorted[Math.floor(count * 0.5)] ?? 0,
    p95: sorted[Math.floor(count * 0.95)] ?? 0,
    p99: sorted[Math.floor(count * 0.99)] ?? 0,
    failures,
  };
}

function printStats(label: string, stats: LatencyStats): void {
  console.log(
    `\n  [${label}] n=${stats.count} failures=${stats.failures}\n` +
      `    min=${stats.min}ms  p50=${stats.p50}ms  p95=${stats.p95}ms  p99=${stats.p99}ms  max=${stats.max}ms  mean=${stats.mean}ms`,
  );
}

async function measureCommand(
  type: string,
  params: Record<string, unknown> = {},
): Promise<{ durationMs: number; success: boolean }> {
  const start = performance.now();
  const res = await sendCommand(type as never, params, 5_000);
  return { durationMs: Math.round(performance.now() - start), success: res.success };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('bridge stress tests (requires REAPER)', () => {
  let bridgeAvailable = false;

  beforeAll(async () => {
    bridgeAvailable = await isBridgeRunning();
    if (!bridgeAvailable) {
      console.log('\n  ⏭  REAPER bridge not running — skipping stress tests\n');
    }
  });

  function requireBridge() {
    if (!bridgeAvailable) {
      console.log('    skipped (no bridge)');
      return false;
    }
    return true;
  }

  /* ---- Baseline: single-command round-trip ---- */

  it('baseline: single get_project_info round-trip < 150ms', async () => {
    if (!requireBridge()) return;

    const { durationMs, success } = await measureCommand('get_project_info');
    expect(success).toBe(true);
    expect(durationMs).toBeLessThan(150);
    console.log(`    baseline round-trip: ${durationMs}ms`);
  });

  /* ---- Sequential rapid-fire ---- */

  it('sequential: 50 rapid get_project_info calls, p95 < 100ms', async () => {
    if (!requireBridge()) return;

    const durations: number[] = [];
    let failures = 0;

    for (let i = 0; i < 50; i++) {
      const { durationMs, success } = await measureCommand('get_project_info');
      durations.push(durationMs);
      if (!success) failures++;
    }

    const stats = computeStats(durations, failures);
    printStats('sequential-50', stats);

    expect(stats.failures).toBe(0);
    expect(stats.p95).toBeLessThan(100);
  }, 30_000);

  /* ---- Concurrent burst ---- */

  it('concurrent: 20 simultaneous get_project_info calls, all succeed < 500ms', async () => {
    if (!requireBridge()) return;

    const promises = Array.from({ length: 20 }, () => measureCommand('get_project_info'));
    const results = await Promise.all(promises);

    const durations = results.map((r) => r.durationMs);
    const failures = results.filter((r) => !r.success).length;
    const stats = computeStats(durations, failures);
    printStats('concurrent-20', stats);

    expect(stats.failures).toBe(0);
    expect(stats.max).toBeLessThan(500);
  }, 15_000);

  /* ---- Concurrent burst (large) ---- */

  it('concurrent: 50 simultaneous get_project_info calls, all succeed < 2s', async () => {
    if (!requireBridge()) return;

    const promises = Array.from({ length: 50 }, () => measureCommand('get_project_info'));
    const results = await Promise.all(promises);

    const durations = results.map((r) => r.durationMs);
    const failures = results.filter((r) => !r.success).length;
    const stats = computeStats(durations, failures);
    printStats('concurrent-50', stats);

    expect(stats.failures).toBe(0);
    expect(stats.max).toBeLessThan(2000);
  }, 30_000);

  /* ---- Mixed command types ---- */

  it('sequential: mixed command types maintain consistent latency', async () => {
    if (!requireBridge()) return;

    const commands = [
      'get_project_info',
      'get_transport_state',
      'list_tracks',
      'get_project_info',
      'get_transport_state',
      'list_tracks',
    ];
    const durations: number[] = [];
    let failures = 0;

    for (const cmd of commands) {
      const { durationMs, success } = await measureCommand(cmd);
      durations.push(durationMs);
      if (!success) failures++;
    }

    const stats = computeStats(durations, failures);
    printStats('mixed-sequential', stats);

    expect(stats.failures).toBe(0);
    expect(stats.p95).toBeLessThan(100);
  }, 15_000);

  /* ---- Sustained throughput ---- */

  it('sustained: 100 sequential commands with no degradation, p95 < 100ms', async () => {
    if (!requireBridge()) return;

    const durations: number[] = [];
    let failures = 0;

    for (let i = 0; i < 100; i++) {
      const { durationMs, success } = await measureCommand('get_project_info');
      durations.push(durationMs);
      if (!success) failures++;
    }

    const stats = computeStats(durations, failures);
    printStats('sustained-100', stats);

    // Check no degradation: last 20 commands shouldn't be notably slower than first 20
    const firstBatch = computeStats(durations.slice(0, 20), 0);
    const lastBatch = computeStats(durations.slice(-20), 0);
    console.log(`    first-20 mean=${firstBatch.mean}ms  last-20 mean=${lastBatch.mean}ms`);

    expect(stats.failures).toBe(0);
    expect(stats.p95).toBeLessThan(100);
    // Last batch should not be more than 3x slower than first batch
    expect(lastBatch.mean).toBeLessThan(Math.max(firstBatch.mean * 3, 100));
  }, 60_000);

  /* ---- Large payload: list_tracks ---- */

  it('large payload: list_tracks returns within 200ms', async () => {
    if (!requireBridge()) return;

    const { durationMs, success } = await measureCommand('list_tracks');
    expect(success).toBe(true);
    expect(durationMs).toBeLessThan(200);
    console.log(`    list_tracks round-trip: ${durationMs}ms`);
  });

  /* ---- File contention: interleaved command types ---- */

  it('interleaved: concurrent mixed command types do not interfere', async () => {
    if (!requireBridge()) return;

    const reads = Array.from({ length: 10 }, () => measureCommand('get_project_info'));
    const writes = Array.from({ length: 10 }, () =>
      measureCommand('get_transport_state'),
    );

    const results = await Promise.all([...reads, ...writes]);
    const durations = results.map((r) => r.durationMs);
    const failures = results.filter((r) => !r.success).length;
    const stats = computeStats(durations, failures);
    printStats('interleaved-20', stats);

    expect(stats.failures).toBe(0);
    expect(stats.max).toBeLessThan(500);
  }, 15_000);

  /* ---- No orphaned files after stress ---- */

  it('cleanup: no stale command/response files after test run', async () => {
    if (!requireBridge()) return;

    // Give the bridge a moment to process any in-flight commands
    await new Promise((r) => setTimeout(r, 500));

    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { homedir, platform } = await import('node:os');

    let resourcePath = process.env['REAPER_RESOURCE_PATH'];
    if (!resourcePath) {
      const home = homedir();
      resourcePath =
        platform() === 'darwin'
          ? join(home, 'Library', 'Application Support', 'REAPER')
          : platform() === 'win32'
            ? join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'REAPER')
            : join(home, '.config', 'REAPER');
    }
    const bridgeDir = join(resourcePath, 'Scripts', 'mcp_bridge_data');

    const files = await readdir(bridgeDir);
    const stale = files.filter((f) => f.startsWith('command_') || f.startsWith('response_'));

    if (stale.length > 0) {
      console.log(`    found ${stale.length} orphaned files: ${stale.slice(0, 5).join(', ')}`);
    }
    expect(stale.length).toBe(0);
  });
});
