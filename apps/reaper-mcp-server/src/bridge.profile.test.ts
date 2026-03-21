/**
 * Bridge latency profiling — identifies WHERE time is spent per command.
 *
 * Requires REAPER with mcp_bridge.lua running.
 * Must run with BRIDGE_PROFILE=1 to enable phase timing.
 *
 * Run with:
 *   BRIDGE_PROFILE=1 pnpm vitest run apps/reaper-mcp-server/src/bridge.profile.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { sendCommand, isBridgeRunning, lastTimings } from './bridge.js';
import type { BridgePhaseTimings } from './bridge.js';

describe('bridge latency profiling (requires REAPER + BRIDGE_PROFILE=1)', () => {
  let bridgeAvailable = false;

  beforeAll(async () => {
    bridgeAvailable = await isBridgeRunning();
    if (!bridgeAvailable) {
      console.log('\n  ⏭  REAPER bridge not running — skipping profile tests\n');
    }
    if (!process.env['BRIDGE_PROFILE']) {
      console.log('\n  ⏭  BRIDGE_PROFILE=1 not set — skipping profile tests\n');
    }
  });

  function skip() {
    return !bridgeAvailable || process.env['BRIDGE_PROFILE'] !== '1';
  }

  it('phase breakdown: 20 sequential get_project_info commands', async () => {
    if (skip()) return;

    const allTimings: BridgePhaseTimings[] = [];

    for (let i = 0; i < 20; i++) {
      await sendCommand('get_project_info' as never, {}, 5_000);
      if (lastTimings) {
        allTimings.push({ ...lastTimings });
      }
    }

    expect(allTimings.length).toBe(20);

    // Compute averages per phase
    const phases = [
      'spanSetupMs', 'ensureDirMs', 'writeMs', 'logMs',
      'pollWaitMs', 'readParseMs', 'cleanupMs', 'metricsMs', 'totalMs',
    ] as const;

    console.log('\n  === Phase Breakdown (20 sequential get_project_info) ===\n');
    console.log('  Phase           | Avg (ms) | Min (ms) | Max (ms) | % of Total');
    console.log('  ----------------|----------|----------|----------|----------');

    const avgTotal = allTimings.reduce((s, t) => s + t.totalMs, 0) / allTimings.length;

    for (const phase of phases) {
      const values = allTimings.map((t) => t[phase]);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const pct = phase === 'totalMs' ? '100.0' : ((avg / avgTotal) * 100).toFixed(1);
      console.log(
        `  ${phase.padEnd(16)}| ${avg.toFixed(1).padStart(8)} | ${String(min).padStart(8)} | ${String(max).padStart(8)} | ${pct.padStart(8)}%`,
      );
    }

    const avgAttempts =
      allTimings.reduce((s, t) => s + t.pollAttempts, 0) / allTimings.length;
    console.log(`\n  Avg poll attempts: ${avgAttempts.toFixed(1)}`);
    console.log(`  Avg total round-trip: ${avgTotal.toFixed(1)}ms\n`);
  }, 30_000);

  it('phase breakdown: 10 sequential list_tracks (larger payload)', async () => {
    if (skip()) return;

    const allTimings: BridgePhaseTimings[] = [];

    for (let i = 0; i < 10; i++) {
      await sendCommand('list_tracks' as never, {}, 5_000);
      if (lastTimings) {
        allTimings.push({ ...lastTimings });
      }
    }

    expect(allTimings.length).toBe(10);

    const phases = [
      'spanSetupMs', 'ensureDirMs', 'writeMs', 'logMs',
      'pollWaitMs', 'readParseMs', 'cleanupMs', 'metricsMs', 'totalMs',
    ] as const;

    console.log('\n  === Phase Breakdown (10 sequential list_tracks) ===\n');
    console.log('  Phase           | Avg (ms) | Min (ms) | Max (ms) | % of Total');
    console.log('  ----------------|----------|----------|----------|----------');

    const avgTotal = allTimings.reduce((s, t) => s + t.totalMs, 0) / allTimings.length;

    for (const phase of phases) {
      const values = allTimings.map((t) => t[phase]);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const pct = phase === 'totalMs' ? '100.0' : ((avg / avgTotal) * 100).toFixed(1);
      console.log(
        `  ${phase.padEnd(16)}| ${avg.toFixed(1).padStart(8)} | ${String(min).padStart(8)} | ${String(max).padStart(8)} | ${pct.padStart(8)}%`,
      );
    }

    const avgAttempts =
      allTimings.reduce((s, t) => s + t.pollAttempts, 0) / allTimings.length;
    console.log(`\n  Avg poll attempts: ${avgAttempts.toFixed(1)}`);
    console.log(`  Avg total round-trip: ${avgTotal.toFixed(1)}ms\n`);
  }, 30_000);

  it('isolation: measure overhead without bridge (direct file I/O baseline)', async () => {
    if (skip()) return;

    const { writeFile, readFile, unlink } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { randomUUID } = await import('node:crypto');
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

    const iterations = 50;
    const writeTimes: number[] = [];
    const readTimes: number[] = [];
    const unlinkTimes: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const id = randomUUID();
      const path = join(bridgeDir, `_profile_test_${id}.json`);
      const payload = JSON.stringify({ id, type: 'test', params: {}, timestamp: Date.now() }, null, 2);

      const tw = performance.now();
      await writeFile(path, payload, 'utf-8');
      writeTimes.push(performance.now() - tw);

      const tr = performance.now();
      await readFile(path, 'utf-8');
      readTimes.push(performance.now() - tr);

      const tu = performance.now();
      await unlink(path);
      unlinkTimes.push(performance.now() - tu);
    }

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const max = (arr: number[]) => Math.max(...arr);

    console.log('\n  === Raw File I/O Baseline (50 iterations) ===\n');
    console.log(`  writeFile:  avg=${avg(writeTimes).toFixed(2)}ms  max=${max(writeTimes).toFixed(2)}ms`);
    console.log(`  readFile:   avg=${avg(readTimes).toFixed(2)}ms  max=${max(readTimes).toFixed(2)}ms`);
    console.log(`  unlink:     avg=${avg(unlinkTimes).toFixed(2)}ms  max=${max(unlinkTimes).toFixed(2)}ms`);
    console.log(`  total I/O:  avg=${(avg(writeTimes) + avg(readTimes) + avg(unlinkTimes)).toFixed(2)}ms\n`);
  }, 15_000);
});
