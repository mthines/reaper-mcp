import { VST3_HEADER_BYTES, withVst3Lengths } from '../vst3-state.js';

/** A header + state the way REAPER writes them: 16 bytes of prefix, then the plugin's bytes, both lengths set. */
export function consistentVst3(payload: Uint8Array): { header: Uint8Array; state: Uint8Array } {
  const state = new Uint8Array(16 + payload.length);
  state.set(payload, 16);
  return withVst3Lengths(new Uint8Array(VST3_HEADER_BYTES), state);
}
