import { parseParams, type CommandEntry } from '../../lib/commands.js';

export const fmt = (v: number | undefined, digits = 1) =>
  v === undefined ? '–' : v <= -149 ? '−∞' : (v > 0 ? `+${v.toFixed(digits)}` : v.toFixed(digits)).replace('-', '−');
export const pct = (v: number, min: number, max: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));

export type Zone = 'ok' | 'hot' | 'over';
/** Level zones: amber from −6 dB, red over 0 dB */
export const zoneOf = (db: number | undefined): Zone => (db === undefined ? 'ok' : db > 0 ? 'over' : db > -6 ? 'hot' : 'ok');
export const ZONE_WORD: Record<Zone, string | null> = { ok: null, hot: 'hot', over: 'over 0' };
/** True peak: amber over −1 dBTP (the streaming ceiling), red over 0 */
export const tpZone = (v?: number): Zone => (v === undefined ? 'ok' : v > 0 ? 'over' : v > -1 ? 'hot' : 'ok');
export const tpWord = (v?: number) => (v === undefined ? undefined : v > 0 ? 'over 0' : v > -1 ? 'over −1' : undefined);

/** The loudness the agent said it is working to (`targetLufs` on the call), if any */
export function targetOf(e: CommandEntry): number | null {
  const p = parseParams(e.p);
  const t = p && typeof p === 'object' ? (p as Record<string, unknown>).targetLufs : undefined;
  return typeof t === 'number' && t < 0 && t > -60 ? t : null;
}
