

/** Command timeline published by the bridge: sparse buckets, `[bucketId, total, errors, slow, sumMs]`. */
export interface BridgeHistory {
  v: number;
  /** Bucket size in ms; bucket start = bucketId * size */
  size: number;
  b: Array<[number, number, number, number, number]>;
}

type Bucket = [number, number, number, number, number];

/** The day/week timeline (ExtState `history_long`): 1m buckets for 24h and 10m buckets for 7d. */
export interface LongHistory {
  v: number;
  tiers: Array<{ size: number; b: Bucket[] }>;
}

/** How far back each bucket size reaches; mirrors HISTORY_TIERS in reaper/mcp_bridge.lua. */
const TIER_SPAN_MS: Record<number, number> = { 10_000: 3_600_000, 60_000: 86_400_000, 600_000: 7 * 86_400_000 };

/** Every timeline tier the bridge publishes, finest first. */
export function historyTiers(history: BridgeHistory | null, long: LongHistory | null): BridgeHistory[] {
  const tiers: BridgeHistory[] = history ? [history] : [];
  for (const t of long?.tiers ?? []) tiers.push({ v: long?.v ?? 1, size: t.size, b: t.b });
  return tiers.sort((a, b) => a.size - b.size);
}

/**
 * Bars for a range from the finest tier that both reaches back over the whole range and fits whole
 * buckets into a bar (10s buckets for an hour, 1m for a day, 10m for a week).
 */
export function timelineBars(tiers: BridgeHistory[], rangeMs: number, bars: number, now: number): TimeBar[] {
  const barMs = rangeMs / bars;
  const fits = tiers.filter((t) => t.size <= barMs && barMs % t.size === 0);
  const tier = fits.find((t) => (TIER_SPAN_MS[t.size] ?? 0) >= rangeMs) ?? fits[fits.length - 1] ?? null;
  return bucketize(tier, rangeMs, bars, now);
}

/** A time span picked on the chart: [start, end) in epoch ms. */
export interface Span {
  start: number;
  end: number;
}

/** The span covered by bars `from`..`to` (either order, inclusive). */
export function spanOfBars(bars: TimeBar[], from: number, to: number): Span {
  const [a, b] = from <= to ? [from, to] : [to, from];
  return { start: bars[a].start, end: bars[b].end };
}

/** The entries inside the span; all of them when there is no span. */
export function inSpan<T extends { t: number }>(entries: T[], span: Span | null): T[] {
  return span ? entries.filter((e) => e.t >= span.start && e.t < span.end) : entries;
}

export interface TimeBar {
  start: number;
  end: number;
  total: number;
  errors: number;
  slow: number;
  /** Average handler ms, null when the bar is empty */
  avgMs: number | null;
}

/** Group the bridge's buckets into `bars` equal bars covering the last `rangeMs`. */
export function bucketize(history: BridgeHistory | null, rangeMs: number, bars: number, now: number): TimeBar[] {
  const barMs = rangeMs / bars;
  // Align to bar boundaries so bars don't shift every second; the last bar holds "now"
  const start = Math.ceil(now / barMs) * barMs - rangeMs;
  const size = history?.size ?? 1;
  const sums = Array.from({ length: bars }, (_, i) => ({ start: start + i * barMs, end: start + (i + 1) * barMs, total: 0, errors: 0, slow: 0, ms: 0 }));
  for (const [id, total, errors, slow, ms] of history?.b ?? []) {
    const i = Math.floor((id * size - start) / barMs);
    if (i < 0 || i >= bars) continue;
    sums[i].total += total;
    sums[i].errors += errors;
    sums[i].slow += slow;
    sums[i].ms += ms;
  }
  return sums.map(({ ms, ...bar }) => ({ ...bar, avgMs: bar.total ? ms / bar.total : null }));
}
