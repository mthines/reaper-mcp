/**
 * Vital's saved state inside the VST3 state REAPER keeps: a 16-byte REAPER prefix, a JUCE `CcnK`/`FBCh`
 * plugin bank (a byte size at CcnK+4, the plugin chunk's size just before the JSON) and then Vital's own
 * JSON, followed by a few bytes of JUCE trailer. Same JSON as a `.vital` preset file.
 *
 * Editing the JSON changes its length, so both sizes move by the difference and everything else stays
 * byte for byte. (The two outer VST3 lengths are fixed by the extension API's fxState.set.)
 */

export interface VitalSettings {
  wavetables: unknown[];
  lfos: { name: string; num_points: number; points: number[]; powers: number[]; smooth: boolean }[];
  modulations: { source: string; destination: string }[];
  [key: string]: unknown;
}

export interface VitalPatch {
  author?: string;
  preset_name?: string;
  preset_style?: string;
  macro1?: string;
  macro2?: string;
  macro3?: string;
  macro4?: string;
  settings: VitalSettings;
  [key: string]: unknown;
}

export interface ParsedVitalState {
  patch: VitalPatch;
  /** Bytes from the start of the state to the JSON's first character */
  before: Uint8Array;
  /** Bytes after the JSON's last character (JUCE trailer) */
  after: Uint8Array;
  jsonStart: number;
  jsonEnd: number;
  bankOffset: number;
}

const CCNK = [0x43, 0x63, 0x6e, 0x4b];
const FBCH = [0x46, 0x42, 0x43, 0x68];

const readU32BE = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
function writeU32BE(b: Uint8Array, at: number, v: number): void {
  b[at] = (v >>> 24) & 0xff;
  b[at + 1] = (v >>> 16) & 0xff;
  b[at + 2] = (v >>> 8) & 0xff;
  b[at + 3] = v & 0xff;
}

function indexOfBytes(b: Uint8Array, needle: number[], from: number, to: number): number {
  outer: for (let i = from; i <= Math.min(to, b.length) - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (b[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Index one past the `}` that closes the object starting at `start`, or -1. Respects strings and escapes. */
function jsonObjectEnd(b: Uint8Array, start: number, limit: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < limit; i++) {
    const c = b[i];
    if (inString) {
      if (c === 0x5c) i++;
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) inString = true;
    else if (c === 0x7b) depth++;
    else if (c === 0x7d && --depth === 0) return i + 1;
  }
  return -1;
}

export type ParseResult = { ok: true; value: ParsedVitalState } | { ok: false; error: string };

export function parseVitalState(state: Uint8Array): ParseResult {
  const bankOffset = indexOfBytes(state, CCNK, 16, 64);
  if (bankOffset < 0 || indexOfBytes(state, FBCH, bankOffset + 8, bankOffset + 12) !== bankOffset + 8) {
    return { ok: false, error: 'This is not the state layout Vital writes (no JUCE plugin bank); is the FX really Vital?' };
  }
  const jsonStart = indexOfBytes(state, [0x7b, 0x22], bankOffset + 28, bankOffset + 400);
  if (jsonStart < 0) return { ok: false, error: "Could not find Vital's JSON in the plugin state" };
  const chunkSize = readU32BE(state, jsonStart - 4);
  const limit = jsonStart + chunkSize;
  if (chunkSize === 0 || limit > state.length) return { ok: false, error: "Vital's chunk size does not fit the state; refusing to edit it" };
  const jsonEnd = jsonObjectEnd(state, jsonStart, limit);
  if (jsonEnd < 0) return { ok: false, error: "Vital's JSON is not complete" };

  let patch: VitalPatch;
  try {
    patch = JSON.parse(Buffer.from(state.subarray(jsonStart, jsonEnd)).toString('utf8')) as VitalPatch;
  } catch {
    return { ok: false, error: "Vital's JSON could not be parsed" };
  }
  const s = patch?.settings;
  if (!s || typeof s !== 'object' || !Array.isArray(s.wavetables) || !Array.isArray(s.modulations) || !Array.isArray(s.lfos)) {
    return { ok: false, error: 'The JSON has no Vital settings (wavetables, lfos, modulations)' };
  }
  return {
    ok: true,
    value: { patch, before: state.slice(0, jsonStart), after: state.slice(jsonEnd), jsonStart, jsonEnd, bankOffset },
  };
}

/** The state with `patch` in place of the JSON: the two plugin sizes follow the new length, every other byte is kept. */
export function buildVitalState(parsed: ParsedVitalState, patch: VitalPatch): Uint8Array {
  const json = Buffer.from(JSON.stringify(patch), 'utf8');
  const delta = json.length - (parsed.jsonEnd - parsed.jsonStart);
  const out = new Uint8Array(parsed.before.length + json.length + parsed.after.length);
  out.set(parsed.before, 0);
  out.set(json, parsed.before.length);
  out.set(parsed.after, parsed.before.length + json.length);
  writeU32BE(out, parsed.jsonStart - 4, readU32BE(out, parsed.jsonStart - 4) + delta);
  writeU32BE(out, parsed.bankOffset + 4, readU32BE(out, parsed.bankOffset + 4) + delta);
  return out;
}
