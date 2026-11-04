/**
 * REAPER stores a VST3's state in a track chunk as base64: a 44-byte header line, then the state.
 * Both carry a length that REAPER checks. Verified on Vital (2026-11-04): editing the state without
 * fixing them makes REAPER silently ignore the new state, even for an untouched real one.
 *
 *   header bytes 32..35 (little-endian)  = state length
 *   state  bytes  0..3  (little-endian)  = state length - 16
 *
 * Plugin-level sizes inside the state (a JUCE `CcnK` bank, a chunk size) are the extension's own business.
 */

export const VST3_HEADER_BYTES = 44;
const HEADER_LENGTH_AT = 32;
const STATE_PREFIX_DELTA = 16;

function readU32LE(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

function writeU32LE(b: Uint8Array, at: number, v: number): void {
  b[at] = v & 0xff;
  b[at + 1] = (v >>> 8) & 0xff;
  b[at + 2] = (v >>> 16) & 0xff;
  b[at + 3] = (v >>> 24) & 0xff;
}

/** True when both length fields match the state's real size, as in a chunk REAPER itself wrote. */
export function isVst3StateConsistent(header: Uint8Array, state: Uint8Array): boolean {
  if (header.length !== VST3_HEADER_BYTES || state.length < 4 + STATE_PREFIX_DELTA) return false;
  return readU32LE(header, HEADER_LENGTH_AT) === state.length && readU32LE(state, 0) === state.length - STATE_PREFIX_DELTA;
}

/**
 * True when the wrapper is one we can safely rewrite: a 44-byte header whose length agrees with the state's own
 * prefix, and no claim of more bytes than the state holds. Unlike `isVst3StateConsistent` it accepts a state
 * longer than its fields say. Seen live on Vital (2026-11-04): after REAPER loads an edited state, the plugin
 * saves itself again with a few more trailing bytes, while REAPER keeps the lengths it was given. `withVst3Lengths`
 * then sets both fields from the new state, so nothing stale survives a write.
 */
export function isVst3WrapperCoherent(header: Uint8Array, state: Uint8Array): boolean {
  if (header.length !== VST3_HEADER_BYTES || state.length < 4 + STATE_PREFIX_DELTA) return false;
  const claimed = readU32LE(header, HEADER_LENGTH_AT);
  return readU32LE(state, 0) === claimed - STATE_PREFIX_DELTA && claimed <= state.length;
}

/** A copy of `header` and `state` with both length fields set to the state's size. Inputs are not modified. */
export function withVst3Lengths(header: Uint8Array, state: Uint8Array): { header: Uint8Array; state: Uint8Array } {
  if (header.length !== VST3_HEADER_BYTES) {
    throw new Error(`VST3 header must be ${VST3_HEADER_BYTES} bytes, got ${header.length}`);
  }
  if (state.length < 4 + STATE_PREFIX_DELTA) throw new Error('VST3 state is too short');
  const h = Uint8Array.from(header);
  const s = Uint8Array.from(state);
  writeU32LE(h, HEADER_LENGTH_AT, s.length);
  writeU32LE(s, 0, s.length - STATE_PREFIX_DELTA);
  return { header: h, state: s };
}
