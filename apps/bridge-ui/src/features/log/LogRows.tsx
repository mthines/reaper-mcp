import { memo, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { prependedCount, scrollToRow, visibleRows } from './virtual-list.js';
import { SPEED_LABEL, latencyScale } from './speed.js';
import { formatAgo, formatDay, formatMs } from '../../lib/format.js';
import { speedOf, outcomeOf, type CommandEntry } from '../../lib/commands.js';
import { sessionHue, sessionName, type Session } from '../../lib/sessions.js';
import { cx } from '../../lib/cx.js';
import styles from './LogRows.module.css';

/** Height of one log row in px; the list is windowed, so every row must be exactly this tall. */
const ROW_HEIGHT = 32;
/** Top padding of `.rows`, before the first row */
const ROWS_PAD = 4;
/** Rows rendered above and below the viewport, so fast scrolling doesn't show blank space */
const ROWS_OVERSCAN = 10;

/**
 * The command log, windowed: only the rows in (and near) the viewport are in the DOM. Keeps the
 * selected row in view (↑/↓ in the details sidebar) and keeps the reader's place when new commands
 * arrive above while they're scrolled down.
 */
/** The React Compiler treats a node reached through a ref as frozen inside a component; the scroll position is set here. */
function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
}

export function LogRows({
  rows,
  today,
  selectedN,
  sessionOf,
  onSelect,
}: {
  rows: CommandEntry[];
  today: number;
  selectedN: number | undefined;
  /** Set when several agents share the log, to tag each row with its agent */
  sessionOf: ((id: string) => Session) | null;
  onSelect: (e: CommandEntry) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });

  // The scroll container is the parent `.rows`, which also holds the empty state
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const update = () => setView((v) => (v.top === el.scrollTop && v.height === el.clientHeight ? v : { top: el.scrollTop, height: el.clientHeight }));
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  const firstN = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    const added = prependedCount(firstN.current, rows.map((e) => e.n));
    firstN.current = rows[0]?.n;
    if (el && added > 0 && el.scrollTop > 0) scrollTo(el, el.scrollTop + added * ROW_HEIGHT);
  }, [rows]);

  // Only when the selection moves, not on every new row
  const revealSelected = useEffectEvent(() => {
    const el = ref.current?.parentElement;
    if (!el || selectedN === undefined) return;
    const i = rows.findIndex((e) => e.n === selectedN);
    if (i >= 0) scrollTo(el, scrollToRow(el.scrollTop, el.clientHeight, ROW_HEIGHT, i, ROWS_PAD));
  });
  useLayoutEffect(() => revealSelected(), [selectedN]);

  const { start, end } = visibleRows(view.top, view.height, ROW_HEIGHT, rows.length, ROWS_OVERSCAN, ROWS_PAD);
  return (
    <div ref={ref} className={styles.rowsWindow} style={{ height: rows.length * ROW_HEIGHT }}>
      <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
        {rows.slice(start, end).map((e) => (
          <Row
            key={e.n}
            entry={e}
            today={today}
            session={sessionOf && e.s ? sessionOf(e.s) : null}
            selected={selectedN === e.n}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

/** Memoized: re-renders only when its own entry, selection, agent tag or the day changes. */
const Row = memo(
  function Row({
    entry: e,
    today,
    session,
    selected,
    onSelect,
  }: {
    entry: CommandEntry;
    /** Start of today, for the Today / Yesterday / date label */
    today: number;
    /** Shown as a tag when several agents share the log */
    session: Session | null;
    selected: boolean;
    onSelect: (e: CommandEntry) => void;
  }) {
    const time = new Date(e.t);
    const hhmmss = time.toLocaleTimeString([], { hour12: false });
    const ms = String(time.getMilliseconds()).padStart(3, '0');
    const speed = speedOf(e.c, e.ms);
    return (
      <div className={cx(styles.row, selected && styles.rowSelected)} data-outcome={outcomeOf(e)}>
        <button className={styles.rowMain} style={{ height: ROW_HEIGHT }} onClick={() => onSelect(e)} aria-pressed={selected}>
          {/* "x ago" is set on hover, so the row needn't re-render every second to keep it fresh */}
          <span className={cx(styles.rowTime, 'mono')} onMouseEnter={(ev) => (ev.currentTarget.title = formatAgo(Date.now() - e.t))}>
            <span className={styles.rowDay}>{formatDay(e.t, today)}</span>
            {hhmmss}
            <span className={styles.rowMs}>.{ms}</span>
          </span>
          <span className={styles.statusDot} data-outcome={outcomeOf(e)} />
          <span className={cx(styles.rowCmd, 'mono')}>{e.c}</span>
          {e.e && <span className={styles.rowErrInline}>{e.e}</span>}
          <span className={styles.rowEnd}>
            {session && (
              <span className={styles.rowSession} title={session.dir ?? session.id}>
                <i className={`sdot hue-${sessionHue(session.id)}`} />
                {sessionName(session)}
              </span>
            )}
            <span className={cx(styles.rowDur, 'mono')} data-speed={speed} title={speed === 'long' ? SPEED_LABEL.long : undefined}>
              <span className={styles.durTrack} aria-hidden>
                <span className={styles.durFill} style={{ width: `${latencyScale(e.ms) * 100}%` }} />
              </span>
              {formatMs(e.ms)}
            </span>
          </span>
        </button>
      </div>
    );
  },
  // A missing session is rebuilt per render by sessionOf, so compare agent tags by what they show
  (a, b) =>
    a.entry === b.entry &&
    a.today === b.today &&
    a.selected === b.selected &&
    a.onSelect === b.onSelect &&
    a.session?.id === b.session?.id &&
    a.session?.label === b.session?.label &&
    a.session?.dir === b.session?.dir,
);
