import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { track } from '../../lib/analytics.js';
import { DAY, MINUTE, RANGE_OPTIONS, type RangeKey, barWidth, rangeOf } from './ranges.js';
import { formatMs } from '../../lib/format.js';
import { SLOW_MS } from '../../lib/commands.js';
import { historyTiers, spanOfBars, timelineBars, type BridgeHistory, type LongHistory, type Span, type TimeBar } from '../../lib/timeline.js';
import { clearedBefore } from '../../lib/log.js';
import { Combobox } from '../../components/index.js';
import { cx } from '../../lib/cx.js';
import styles from './Timeline.module.css';

/** Round up to a readable, even axis maximum with ~10% headroom, at least 4. */
function niceMax(v: number): number {
  const target = Math.max(4, v * 1.1);
  const pow = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 3, 4, 5, 6, 8, 10].map((m) => m * pow).find((n) => n >= target) ?? target;
}

export const clock = (t: number, seconds = false) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: false });

/** Clock time within a day, weekday + time beyond it */
const stamp = (t: number, rangeMs: number, seconds = false) =>
  rangeMs > DAY ? `${new Date(t).toLocaleDateString([], { weekday: 'short' })} ${clock(t)}` : clock(t, seconds);

/** "Mon 14:02 – Mon 15:00", with the weekday only when the span leaves today */
export function spanLabel(span: Span): string {
  const today = new Date().toDateString();
  const fmt = (t: number) => (new Date(t).toDateString() === today ? clock(t) : `${new Date(t).toLocaleDateString([], { weekday: 'short' })} ${clock(t)}`);
  return `${fmt(span.start)} – ${fmt(span.end)}`;
}

/** Which bar the pointer is over, clamped to the plot */
function barAt(plot: HTMLElement, clientX: number, count: number): number {
  const r = plot.getBoundingClientRect();
  return Math.min(count - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * count)));
}

/**
 * Commands per time slot over a fixed window (stacked ok / slow / error). Drag across bars (or
 * click one) to select a span: the log below filters to it, and the range stays as it is.
 * Without a span, the log shows the range.
 */
export function Timeline({
  history,
  longHistory,
  now,
  rangeKey,
  onRange,
  selection,
  onSelect,
  clearedAt,
}: {
  history: BridgeHistory | null;
  longHistory: LongHistory | null;
  now: number;
  rangeKey: RangeKey;
  onRange: (key: RangeKey) => void;
  selection: Span | null;
  onSelect: (span: Span | null) => void;
  /** Bars that ended before the viewer's last Clear are drawn empty */
  clearedAt: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const range = rangeOf(rangeKey);
  const tiers = useMemo(() => historyTiers(history, longHistory), [history, longHistory]);
  const bars = useMemo(() => clearedBefore(timelineBars(tiers, range.ms, range.bars, now), clearedAt), [tiers, range, now, clearedAt]);
  const peak = Math.max(0, ...bars.map((b) => b.total));
  const yMax = niceMax(peak);
  const total = bars.reduce((sum, b) => sum + b.total, 0);
  const barMs = range.ms / range.bars;

  // While dragging, the drag is the selection; otherwise bars inside the selected span
  const picked = drag ? spanOfBars(bars, drag.from, drag.to) : selection;
  const isPicked = (b: TimeBar) => picked !== null && b.start >= picked.start && b.end <= picked.end;
  const pickedTotal = picked ? bars.filter(isPicked).reduce((sum, b) => sum + b.total, 0) : 0;

  const onPointerDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const i = barAt(ev.currentTarget, ev.clientX, bars.length);
    setDrag({ from: i, to: i });
  };
  const onPointerMove = (ev: ReactPointerEvent<HTMLDivElement>) => {
    const i = barAt(ev.currentTarget, ev.clientX, bars.length);
    setHover(i);
    if (drag && i !== drag.to) setDrag({ ...drag, to: i });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const span = spanOfBars(bars, drag.from, drag.to);
    setDrag(null);
    // Clicking the one selected bar again clears the selection
    const next = selection && selection.start === span.start && selection.end === span.end ? null : span;
    track({ name: 'timeline_span_selected', selected: next !== null });
    onSelect(next);
  };

  const hb: TimeBar | undefined = hover === null || drag ? undefined : bars[hover];
  const leftPct = hover === null ? 0 : ((hover + 0.5) / bars.length) * 100;
  const tipAlign = leftPct < 15 ? 'start' : leftPct > 85 ? 'end' : 'center';

  return (
    <section className={styles.timeline} aria-label="Commands over time">
      <div className={styles.timelineHead}>
        <span className={styles.timelineTitle}>
          Commands{' '}
          <span className={styles.timelineSub}>
            {total.toLocaleString()} in the {range.label.toLowerCase()} · {barWidth(barMs)} per bar
          </span>
        </span>
        <div className={styles.timelineControls}>
          <span className={styles.legend}>
            <i className={cx(styles.lg, styles.lgOk)} /> ok
            <i className={cx(styles.lg, styles.lgSlow)} /> ≥ {SLOW_MS} ms
            <i className={cx(styles.lg, styles.lgErr)} /> error
          </span>
          <Combobox label="Time range" value={rangeKey} options={RANGE_OPTIONS} onChange={onRange} />
        </div>
      </div>
      <div className={styles.timelineChart}>
        <div className={styles.yAxis} aria-hidden>
          <span>{yMax}</span>
          <span>{yMax / 2}</span>
          <span>0</span>
        </div>
        <div
          className={cx(styles.plot, picked ? styles.plotPicking : '', bars.length > 100 ? styles.plotDense : '')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          onMouseLeave={() => setHover(null)}
          title="Drag to select a span; the log shows only its commands"
        >
          <div className={styles.grid} aria-hidden />
          {bars.map((b, i) => {
            const ok = Math.max(0, b.total - b.errors - b.slow);
            return (
              <div key={b.start} className={cx(styles.tbar, hover === i && !drag ? styles.tbarHover : '', isPicked(b) ? styles.tbarPicked : '')}>
                <div className={styles.tstack} style={{ height: `${(b.total / yMax) * 100}%` }}>
                  {b.errors > 0 && <span className={styles.segErr} style={{ flexGrow: b.errors }} />}
                  {b.slow > 0 && <span className={styles.segSlow} style={{ flexGrow: b.slow }} />}
                  {ok > 0 && <span className={styles.segOk} style={{ flexGrow: ok }} />}
                </div>
              </div>
            );
          })}
          {hb && (
            <div className={styles.ttip} data-align={tipAlign} style={{ left: `${leftPct}%` }}>
              <div className={styles.ttipTime}>
                {stamp(hb.start, range.ms, barMs < MINUTE)}–{clock(hb.end, barMs < MINUTE)}
              </div>
              {hb.total === 0 ? (
                <div className={styles.ttipRow}>No commands</div>
              ) : (
                <>
                  <div className={styles.ttipRow}>
                    <b>{hb.total}</b> command{hb.total === 1 ? '' : 's'}
                  </div>
                  {hb.slow > 0 && (
                    <div className={styles.ttipRow}>
                      <i className={cx(styles.lg, styles.lgSlow)} /> {hb.slow} slow
                    </div>
                  )}
                  {hb.errors > 0 && (
                    <div className={styles.ttipRow}>
                      <i className={cx(styles.lg, styles.lgErr)} /> {hb.errors} error{hb.errors === 1 ? '' : 's'}
                    </div>
                  )}
                  {hb.avgMs !== null && <div className={cx(styles.ttipRow, styles.ttipMuted)}>avg {formatMs(hb.avgMs)}</div>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className={styles.xAxis} aria-hidden>
        <span>−{rangeKey}</span>
        {picked ? (
          <span className={styles.xPicked}>
            {stamp(picked.start, range.ms)}–{stamp(picked.end, range.ms)} · {pickedTotal.toLocaleString()} command{pickedTotal === 1 ? '' : 's'}
          </span>
        ) : (
          <span>{stamp(now - range.ms / 2, range.ms)}</span>
        )}
        <span>now</span>
      </div>
    </section>
  );
}
