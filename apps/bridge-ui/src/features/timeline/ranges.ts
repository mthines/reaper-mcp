import { load } from '../../lib/storage.js';

export const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const RANGES = [
  { key: '5m', label: 'Last 5 minutes', ms: 5 * MINUTE, bars: 30 },
  { key: '10m', label: 'Last 10 minutes', ms: 10 * MINUTE, bars: 60 },
  { key: '30m', label: 'Last 30 minutes', ms: 30 * MINUTE, bars: 60 },
  { key: '1h', label: 'Last hour', ms: HOUR, bars: 60 },
  { key: '6h', label: 'Last 6 hours', ms: 6 * HOUR, bars: 72 },
  { key: '24h', label: 'Last 24 hours', ms: DAY, bars: 96 },
  { key: '7d', label: 'Last 7 days', ms: 7 * DAY, bars: 168 },
] as const;
export type RangeKey = (typeof RANGES)[number]['key'];
export const RANGE_STORAGE_KEY = 'mcp-bridge-range';

/** "10 s", "5 min", "1 h": one bar's width, for the option hints and the header */
export function barWidth(ms: number): string {
  if (ms < MINUTE) return `${ms / 1000} s`;
  if (ms < HOUR) return `${ms / MINUTE} min`;
  return `${ms / HOUR} h`;
}

export const RANGE_OPTIONS = RANGES.map((r) => ({ value: r.key, label: r.label, hint: `${barWidth(r.ms / r.bars)} per bar` }));

export const rangeOf = (key: RangeKey) => RANGES.find((r) => r.key === key) ?? RANGES[2];

export const isRangeKey = (v: unknown): v is RangeKey => RANGES.some((r) => r.key === v);

export function loadRange(): RangeKey {
  const saved = load(RANGE_STORAGE_KEY);
  return isRangeKey(saved) ? saved : '30m';
}
