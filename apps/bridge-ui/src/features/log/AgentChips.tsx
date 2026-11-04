import { useEffect, useRef, useState } from 'react';
import { isConnected, sessionHue, sessionName, type Session } from '../../lib/sessions.js';
import { cx } from '../../lib/cx.js';
import listStyles from '../../styles/list.module.css';
import styles from './AgentChips.module.css';

/** The chips show this many rows until the viewer expands them; keep in step with `--chip-rows` in the CSS module */
const ROWS = 2;
const ROW_HEIGHT = 24;
const GAP = 6;
const COLLAPSED_HEIGHT = ROWS * ROW_HEIGHT + (ROWS - 1) * GAP;

/**
 * The agent filter: an "All agents" chip and one per session, held to two rows. What doesn't fit is counted on a
 * "+N more" button that opens the full list, and "Show less" folds it back. The open and chosen chips stay in order.
 */
export function AgentChips({
  ids,
  sessionOf,
  countOf,
  selected,
  now,
  onPick,
  className,
}: {
  ids: string[];
  sessionOf: (id: string) => Session;
  countOf: (id: string) => number;
  selected: string | null;
  now: number;
  onPick: (id: string | null) => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  // Chips on the third row or beyond, measured from the laid-out chips
  const [beyond, setBeyond] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setBeyond([...el.children].filter((c) => (c as HTMLElement).offsetTop >= COLLAPSED_HEIGHT).length);
    // Fires once on observe, then whenever the box or a chip changes size (a window resize, a count gaining a digit)
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
  }, [ids]);

  return (
    <div className={cx(listStyles.chips, styles.wrap, className)}>
      <div ref={box} className={styles.chips} data-expanded={expanded ? '' : undefined} role="tablist" aria-label="Agent session" id="agent-chips">
        <button role="tab" aria-selected={selected === null} className={listStyles.chip} onClick={() => onPick(null)}>
          All agents
        </button>
        {ids.map((id) => {
          const x = sessionOf(id);
          return (
            <button
              key={id}
              role="tab"
              aria-selected={selected === id}
              className={listStyles.chip}
              title={x.dir ?? id}
              onClick={() => onPick(selected === id ? null : id)}
            >
              <i className={`sdot hue-${sessionHue(id)} ${isConnected(x, now) ? '' : 'sdot-off'}`} />
              {sessionName(x)}
              <span className="count">{countOf(id)}</span>
            </button>
          );
        })}
      </div>
      {(beyond > 0 || expanded) && (
        <button className={cx(listStyles.chip, styles.more)} aria-expanded={expanded} aria-controls="agent-chips" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : `+${beyond} more`}
        </button>
      )}
    </div>
  );
}
