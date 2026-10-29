/**
 * Fixed-height list windowing for the command log: which rows to render for a scroll position, and
 * where to scroll so one row is in view. Rows start `pad` px below the top of the scroll container.
 */
export interface Window {
  /** First rendered row (inclusive) */
  start: number;
  /** Last rendered row (exclusive) */
  end: number;
}

export function visibleRows(
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  count: number,
  overscan: number,
  pad = 0,
): Window {
  const top = Math.max(0, scrollTop - pad);
  const first = Math.floor(top / rowHeight);
  const last = Math.ceil((top + viewport) / rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

/** The scrollTop that brings row `index` fully into view with the least movement (unchanged when it already is). */
export function scrollToRow(scrollTop: number, viewport: number, rowHeight: number, index: number, pad = 0): number {
  const top = pad + index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top === pad ? 0 : top;
  if (bottom > scrollTop + viewport) return bottom - viewport;
  return scrollTop;
}

/**
 * Rows added above the one that was first, so a reader scrolled down keeps their place when newer
 * commands are prepended (what the browser's scroll anchoring did before the list was windowed).
 * 0 when the old first row is gone or still first.
 */
export function prependedCount(previousFirst: number | undefined, keys: readonly number[]): number {
  if (previousFirst === undefined) return 0;
  const i = keys.indexOf(previousFirst);
  return i > 0 ? i : 0;
}
