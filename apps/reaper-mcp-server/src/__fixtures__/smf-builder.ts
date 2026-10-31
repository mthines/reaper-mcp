/** Builds Standard MIDI Files byte by byte for tests. */

const varlen = (n: number): number[] => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** An SMF from tracks of [deltaTicks, ...eventBytes] events (end-of-track added). */
export function smf(tracks: number[][][], { format = 1, ppq = 480 } = {}): Uint8Array {
  const bytes = [...ascii('MThd'), ...u32(6), 0, format, 0, tracks.length, (ppq >> 8) & 0xff, ppq & 0xff];
  for (const events of tracks) {
    const body = events.flatMap(([delta, ...ev]) => [...varlen(delta), ...ev]).concat([0, 0xff, 0x2f, 0]);
    bytes.push(...ascii('MTrk'), ...u32(body.length), ...body);
  }
  return new Uint8Array(bytes);
}
export const meta = (type: number, data: number[]) => [0xff, type, ...varlen(data.length), ...data];
export const name = (s: string) => meta(0x03, ascii(s));
