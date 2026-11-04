import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { BridgeResult, FxLocation, FxState, FxStateClient, Result } from './types.js';
import { isVst3WrapperCoherent, withVst3Lengths } from './vst3-state.js';

/** What the client needs from the host: the bridge, and the folder both sides can read and write. */
export interface FxStateHost {
  bridge(command: 'get_fx_state' | 'set_fx_state', params: Record<string, unknown>, timeoutMs?: number): Promise<BridgeResult>;
  /** The bridge's data folder: state travels as files in it, never inside the command JSON (it is megabytes). */
  bridgeDir(): Promise<string>;
}

const STATE_TIMEOUT_MS = 60_000;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/**
 * Read and write a plugin's saved state through the bridge. The bridge swaps the FX's data lines in the
 * track chunk and gives the FX a new identity so REAPER reloads it; this client keeps the byte-level
 * rules (VST3 lengths) on the TypeScript side, where they can be tested without REAPER.
 */
export function createFxStateClient(host: FxStateHost): FxStateClient {
  async function get(loc: FxLocation): Promise<Result<FxState>> {
    const dir = await host.bridgeDir();
    const outFile = join(dir, `fxstate_${randomUUID()}.out`);
    try {
      const res = await host.bridge('get_fx_state', { trackIndex: loc.trackIndex, fxIndex: loc.fxIndex, outFile }, STATE_TIMEOUT_MS);
      if (!res.success) return fail(res.error ?? 'get_fx_state failed');
      const data = res.data as { name?: string; format?: string } | undefined;
      const [headerB64 = '', stateB64 = ''] = (await readFile(outFile, 'utf8')).split('\n');
      return {
        ok: true,
        value: { name: data?.name ?? '', format: 'vst3', header: unb64(headerB64.trim()), state: unb64(stateB64.trim()) },
      };
    } catch (err) {
      return fail(`get_fx_state failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await unlink(outFile).catch(() => undefined);
    }
  }

  async function set(loc: FxLocation, state: Uint8Array, opts: { expectName?: string } = {}): Promise<Result<{ name: string }>> {
    const current = await get(loc);
    if (!current.ok) return current;
    if (opts.expectName !== undefined && !current.value.name.includes(opts.expectName)) {
      return fail(`FX ${loc.fxIndex} on track ${loc.trackIndex} is "${current.value.name}", not "${opts.expectName}"; nothing changed`);
    }
    // The header and state must agree with each other before we trust our own edit of them.
    if (!isVst3WrapperCoherent(current.value.header, current.value.state)) {
      return fail('The FX state REAPER holds does not have the VST3 layout this client knows; nothing changed');
    }
    let fixed;
    try {
      fixed = withVst3Lengths(current.value.header, state);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
    const dir = await host.bridgeDir();
    const inFile = join(dir, `fxstate_${randomUUID()}.in`);
    try {
      await writeFile(inFile, `${b64(fixed.header)}\n${b64(fixed.state)}\n`, 'utf8');
      const res = await host.bridge(
        'set_fx_state',
        { trackIndex: loc.trackIndex, fxIndex: loc.fxIndex, inFile, expectName: current.value.name },
        STATE_TIMEOUT_MS,
      );
      if (!res.success) return fail(res.error ?? 'set_fx_state failed');
      return { ok: true, value: { name: current.value.name } };
    } catch (err) {
      return fail(`set_fx_state failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await unlink(inFile).catch(() => undefined);
    }
  }

  return { get, set };
}
