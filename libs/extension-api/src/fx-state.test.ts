import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFxStateClient, type FxStateHost } from './fx-state.js';
import type { BridgeResult } from './types.js';
import { isVst3StateConsistent } from './vst3-state.js';
import { consistentVst3 } from './__fixtures__/vst3.js';

/** REAPER's side, as the Lua lib answers it: one FX per slot, state passed through files in the bridge folder. */
function fakeReaper(dir: string, fx: { name: string; header: Uint8Array; state: Uint8Array }[]) {
  const writes: number[] = [];
  const host: FxStateHost = {
    bridgeDir: async () => dir,
    bridge: async (command, params): Promise<BridgeResult> => {
      const slot = fx[params['fxIndex'] as number];
      if (!slot) return { success: false, error: `FX ${String(params['fxIndex'])} not found` };
      if (command === 'get_fx_state') {
        const text = `${Buffer.from(slot.header).toString('base64')}\n${Buffer.from(slot.state).toString('base64')}\n`;
        await writeFile(params['outFile'] as string, text);
        return { success: true, data: { name: slot.name, format: 'vst3' } };
      }
      const [h = '', s = ''] = (await readFile(params['inFile'] as string, 'utf8')).split('\n');
      slot.header = new Uint8Array(Buffer.from(h, 'base64'));
      slot.state = new Uint8Array(Buffer.from(s, 'base64'));
      writes.push(params['fxIndex'] as number);
      return { success: true, data: { name: slot.name } };
    },
  };
  return { host, writes };
}

describe('FX state client', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fxstate-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the state REAPER holds and leaves no file behind', async () => {
    const v = consistentVst3(new Uint8Array([1, 2, 3, 4]));
    const { host } = fakeReaper(dir, [{ name: 'VST3i: Vital (Vital Audio)', ...v }]);
    const r = await createFxStateClient(host).get({ trackIndex: 2, fxIndex: 0 });
    expect(r.ok && r.value.name).toBe('VST3i: Vital (Vital Audio)');
    expect(r.ok && Array.from(r.value.state.slice(16))).toEqual([1, 2, 3, 4]);
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(dir)).toEqual([]);
  });

  it('writes a state of a different size and REAPER ends up with consistent lengths', async () => {
    const v = consistentVst3(new Uint8Array(10));
    const reaper = fakeReaper(dir, [{ name: 'VST3i: Vital (Vital Audio)', ...v }]);
    const newState = new Uint8Array(16 + 5000).fill(5);
    const r = await createFxStateClient(reaper.host).set({ trackIndex: 0, fxIndex: 0 }, newState);
    expect(r).toEqual({ ok: true, value: { name: 'VST3i: Vital (Vital Audio)' } });
    const after = await createFxStateClient(reaper.host).get({ trackIndex: 0, fxIndex: 0 });
    expect(after.ok && isVst3StateConsistent(after.value.header, after.value.state)).toBe(true);
    expect(after.ok && after.value.state.length).toBe(newState.length);
    expect(after.ok && after.value.state[100]).toBe(5);
  });

  it('refuses a write when the FX at that index is not the one the caller expects, and changes nothing', async () => {
    const v = consistentVst3(new Uint8Array(10));
    const reaper = fakeReaper(dir, [{ name: 'VST3: Pro-Q 3 (FabFilter)', ...v }]);
    const r = await createFxStateClient(reaper.host).set({ trackIndex: 0, fxIndex: 0 }, new Uint8Array(64), { expectName: 'Vital' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('not "Vital"');
    expect(reaper.writes).toEqual([]);
  });

  it('edits a state the plugin grew by a few bytes after load (lengths under-claim), ending with consistent lengths', async () => {
    const v = consistentVst3(new Uint8Array(10));
    const grown = new Uint8Array(v.state.length + 6);
    grown.set(v.state);
    const reaper = fakeReaper(dir, [{ name: 'VST3i: Vital (Vital Audio)', header: v.header, state: grown }]);
    const client = createFxStateClient(reaper.host);
    const edited = new Uint8Array(grown.length + 20).fill(5);
    const r = await client.set({ trackIndex: 0, fxIndex: 0 }, edited, { expectName: 'Vital' });
    expect(r.ok).toBe(true);
    const back = await client.get({ trackIndex: 0, fxIndex: 0 });
    expect(back.ok && isVst3StateConsistent(back.value.header, back.value.state)).toBe(true);
  });

  it('refuses to edit a state whose lengths REAPER never wrote consistently, and changes nothing', async () => {
    const v = consistentVst3(new Uint8Array(10));
    v.header[32] ^= 0xff;
    const reaper = fakeReaper(dir, [{ name: 'VST3i: Vital (Vital Audio)', ...v }]);
    const r = await createFxStateClient(reaper.host).set({ trackIndex: 0, fxIndex: 0 }, new Uint8Array(64));
    expect(r.ok).toBe(false);
    expect(reaper.writes).toEqual([]);
  });

  it('passes a bridge refusal through (unknown FX, unsupported format)', async () => {
    const reaper = fakeReaper(dir, []);
    const client = createFxStateClient(reaper.host);
    const g = await client.get({ trackIndex: 0, fxIndex: 3 });
    expect(!g.ok && g.error).toBe('FX 3 not found');
    const s = await client.set({ trackIndex: 0, fxIndex: 3 }, new Uint8Array(64));
    expect(!s.ok && s.error).toBe('FX 3 not found');
  });

  it('cleans up its files when the bridge fails', async () => {
    const host: FxStateHost = { bridgeDir: async () => dir, bridge: async () => ({ success: false, error: 'boom' }) };
    await createFxStateClient(host).get({ trackIndex: 0, fxIndex: 0 });
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(dir)).toEqual([]);
  });
});
