import { parseParams, type CommandEntry } from '../../lib/commands.js';

export const fmt = (v: number | undefined, digits = 1) =>
  v === undefined ? '–' : v <= -149 ? '−∞' : (v > 0 ? `+${v.toFixed(digits)}` : v.toFixed(digits)).replace('-', '−');
export const pct = (v: number, min: number, max: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));

/** Seconds as m:ss */
export const secs = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** A frequency as 63, 250, 1k, 16k */
export const hzLabel = (hz: number) => (hz >= 1000 ? `${+(hz / 1000).toFixed(hz >= 10_000 ? 0 : 1)}k` : `${Math.round(hz)}`);

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

/**
 * One reading for a hover tip, against the previous call when there was one: `Integrated −8.1 → −8.8 LUFS ▼ 0.7 LU`.
 * `deltaUnit` names the change when it differs from the reading's (a loudness change is in LU); `signed: false`
 * drops the `+` on a value that is never negative (a score).
 */
export function tipLine(
  label: string,
  now: number | undefined,
  unit: string,
  was?: number,
  { deltaUnit = unit, digits = 1, signed = true }: { deltaUnit?: string; digits?: number; signed?: boolean } = {},
): string {
  const show = (v: number | undefined) => (signed || v === undefined ? fmt(v, digits) : v.toFixed(digits));
  const u = unit ? ` ${unit}` : '';
  if (was === undefined || was <= -149 || now === undefined || now <= -149) return `${label} ${show(now)}${u}`;
  const d = now - was;
  if (Math.abs(d) < 0.5 * 10 ** -digits) return `${label} ${show(now)}${u}, as in the previous call`;
  return `${label} ${show(was)} → ${show(now)}${u} ${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(digits)}${deltaUnit ? ` ${deltaUnit}` : ''}`;
}
