import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autostartEnabled, autostartInstalled, heartbeatAgeBucket, setupHealthAttributes } from './setup-health.js';
import { AUTOSTART_BLOCK } from './cli.js';

const MIN = 60_000;

describe('heartbeatAgeBucket', () => {
  it.each([
    [6_000, '<1m'],
    [5 * MIN, '1m-1h'],
    [3 * 60 * MIN, '1h-1d'],
    [3 * 24 * 60 * MIN, '1d-7d'],
    [30 * 24 * 60 * MIN, '>7d'],
  ])('puts %i ms in %s', (ms, bucket) => {
    expect(heartbeatAgeBucket(ms)).toBe(bucket);
  });
});

describe('setupHealthAttributes', () => {
  it('tells "REAPER closed" from "bridge stopped" on a stale heartbeat, with how old it is', () => {
    const closed = setupHealthAttributes({ status: { state: 'stale', heartbeatAgeMs: 2 * 60 * MIN }, reaperRunning: false, autostart: true, sidecarInstalled: false });
    const stopped = setupHealthAttributes({ status: { state: 'stale', heartbeatAgeMs: 10 * MIN }, reaperRunning: true, autostart: false, sidecarInstalled: true });

    expect(closed).toEqual({ 'reaper.sidecar.installed': false, 'reaper.bridge.autostart': true, 'reaper.app.running': false, 'reaper.bridge.heartbeat_age': '1h-1d' });
    expect(stopped).toEqual({ 'reaper.sidecar.installed': true, 'reaper.bridge.autostart': false, 'reaper.app.running': true, 'reaper.bridge.heartbeat_age': '1m-1h' });
  });

  it('leaves out whether REAPER runs when the bridge answered', () => {
    expect(setupHealthAttributes({ status: { state: 'connected', heartbeatAgeMs: 1000 }, autostart: true, sidecarInstalled: true }))
      .toEqual({ 'reaper.sidecar.installed': true, 'reaper.bridge.autostart': true });
  });

  it('leaves out autostart when the bridge is not installed, and an unknown process state', () => {
    expect(setupHealthAttributes({ status: { state: 'not_installed' }, reaperRunning: undefined, autostart: false, sidecarInstalled: false }))
      .toEqual({ 'reaper.sidecar.installed': false });
  });
});

describe('autostartInstalled', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds the block setup writes, and nothing in a missing or foreign startup script', () => {
    dir = mkdtempSync(join(tmpdir(), 'setup-health-'));
    expect(autostartInstalled(dir)).toBe(false);
    writeFileSync(join(dir, '__startup.lua'), 'reaper.ShowConsoleMsg("mine")\n');
    expect(autostartInstalled(dir)).toBe(false);
    writeFileSync(join(dir, '__startup.lua'), AUTOSTART_BLOCK.join('\n'));
    expect(autostartInstalled(dir)).toBe(true);
  });
});

describe('autostartEnabled', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is off when the bridge window\'s Start with REAPER setting is off, even with the block in place', () => {
    dir = mkdtempSync(join(tmpdir(), 'setup-health-'));
    writeFileSync(join(dir, '__startup.lua'), AUTOSTART_BLOCK.join('\n'));
    expect(autostartEnabled(dir, dir)).toBe(true); // no saved setting: the block runs the bridge

    writeFileSync(join(dir, 'reaper-extstate.ini'), '[MCPBridge]\ncfg_autostart=0\n');
    expect(autostartEnabled(dir, dir)).toBe(false);

    writeFileSync(join(dir, 'reaper-extstate.ini'), '[MCPBridge]\ncfg_autostart=1\n');
    expect(autostartEnabled(dir, dir)).toBe(true);
  });

  it('is off without the block whatever the setting says', () => {
    dir = mkdtempSync(join(tmpdir(), 'setup-health-'));
    writeFileSync(join(dir, 'reaper-extstate.ini'), '[MCPBridge]\ncfg_autostart=1\n');
    expect(autostartEnabled(dir, dir)).toBe(false);
  });
});
