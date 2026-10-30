import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Combobox } from '../../components/Combobox.js';
import { track } from '../../lib/analytics.js';
import { formatMs, SLOW_MS, historyTiers, spanOfBars, timelineBars, clearedBefore, type BridgeHistory, type LongHistory, type Span, type TimeBar } from '../../lib/status.js';
import { DAY, MINUTE, RANGE_OPTIONS, type RangeKey, barWidth, rangeOf } from './ranges.js';

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
    <section className="timeline" aria-label="Commands over time">
      <div className="timeline-head">
        <span className="timeline-title">
          Commands{' '}
          <span className="timeline-sub">
            {total.toLocaleString()} in the {range.label.toLowerCase()} · {barWidth(barMs)} per bar
          </span>
        </span>
        <div className="timeline-controls">
          <span className="legend">
            <i className="lg lg-ok" /> ok
            <i className="lg lg-slow" /> ≥ {SLOW_MS} ms
            <i className="lg lg-err" /> error
          </span>
          <Combobox label="Time range" value={rangeKey} options={RANGE_OPTIONS} onChange={onRange} />
        </div>
      </div>
      <div className="timeline-chart">
        <div className="y-axis" aria-hidden>
          <span>{yMax}</span>
          <span>{yMax / 2}</span>
          <span>0</span>
        </div>
        <div
          className={`plot ${picked ? 'plot-picking' : ''} ${bars.length > 100 ? 'plot-dense' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          onMouseLeave={() => setHover(null)}
          title="Drag to select a span; the log shows only its commands"
        >
          <div className="grid" aria-hidden />
          {bars.map((b, i) => {
            const ok = Math.max(0, b.total - b.errors - b.slow);
            return (
              <div key={b.start} className={`tbar ${hover === i && !drag ? 'tbar-hover' : ''} ${isPicked(b) ? 'tbar-picked' : ''}`}>
                <div className="tstack" style={{ height: `${(b.total / yMax) * 100}%` }}>
                  {b.errors > 0 && <span className="seg-err" style={{ flexGrow: b.errors }} />}
                  {b.slow > 0 && <span className="seg-slow" style={{ flexGrow: b.slow }} />}
                  {ok > 0 && <span className="seg-ok" style={{ flexGrow: ok }} />}
                </div>
              </div>
            );
          })}
          {hb && (
            <div className={`ttip ttip-${tipAlign}`} style={{ left: `${leftPct}%` }}>
              <div className="ttip-time">
                {stamp(hb.start, range.ms, barMs < MINUTE)}–{clock(hb.end, barMs < MINUTE)}
              </div>
              {hb.total === 0 ? (
                <div className="ttip-row">No commands</div>
              ) : (
                <>
                  <div className="ttip-row">
                    <b>{hb.total}</b> command{hb.total === 1 ? '' : 's'}
                  </div>
                  {hb.slow > 0 && (
                    <div className="ttip-row">
                      <i className="lg lg-slow" /> {hb.slow} slow
                    </div>
                  )}
                  {hb.errors > 0 && (
                    <div className="ttip-row">
                      <i className="lg lg-err" /> {hb.errors} error{hb.errors === 1 ? '' : 's'}
                    </div>
                  )}
                  {hb.avgMs !== null && <div className="ttip-row ttip-muted">avg {formatMs(hb.avgMs)}</div>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="x-axis" aria-hidden>
        <span>−{rangeKey}</span>
        {picked ? (
          <span className="x-picked">
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
