import { useEffect, useRef, useState } from 'react';
import { track } from '../../lib/analytics.js';
import { OUTCOME_LABEL } from './outcome.js';
import { SPEED_LABEL } from './speed.js';
import { formatAgo, formatDay, formatParams } from '../../lib/format.js';
import { termFromSelection } from '../../lib/search.js';
import { speedOf, outcomeOf, type CommandEntry } from '../../lib/commands.js';
import { sessionHue, sessionName, type Session } from '../../lib/sessions.js';
import { Icon, ResizeHandle, useDrawerWidth } from '../../components/index.js';
import { EditView } from '../edit-views/index.js';
import { Measurement } from '../measurements/index.js';
import { cx } from '../../lib/cx.js';
import drawerStyles from '../../styles/drawer.module.css';
import logRowsStyles from './LogRows.module.css';
import styles from './Details.module.css';

/** Right-hand sidebar with everything known about one command. ↑/↓ move between rows, Esc closes. */
export function Details({
  entry: e,
  session,
  now,
  filtered,
  onFilter,
  onAddTerm,
  onClose,
  history,
  onPick,
}: {
  entry: CommandEntry;
  session: Session | null;
  now: number;
  /** The log is already filtered to this command's tool */
  filtered: boolean;
  onFilter: () => void;
  /** Add a search term (from a selection in the params) to the log's filter */
  onAddTerm: (term: string) => void;
  onClose: () => void;
  /** Earlier calls of the same measurement on the same track, for the result's history */
  history: CommandEntry[];
  onPick: (e: CommandEntry) => void;
}) {
  const width = useDrawerWidth();
  const [copied, setCopied] = useState<string | null>(null);
  const time = new Date(e.t);
  const speed = SPEED_LABEL[speedOf(e.c, e.ms)];
  const params = formatParams(e.p);

  const copy = async (what: 'error' | 'params', text: string) => {
    track({ name: 'log_copied', what });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      // clipboard needs a secure context
    }
  };

  return (
    <aside className={drawerStyles.drawer} aria-label={`Details for ${e.c}`} style={width.style}>
      <ResizeHandle fraction={width.fraction} onCommit={width.setFraction} />
      <div className={drawerStyles.drawerHead}>
        <div className={drawerStyles.drawerTitle}>
          <span className={logRowsStyles.statusDot} data-outcome={outcomeOf(e)} />
          <span className={styles.tipAnchor}>
            <button
              className={cx(styles.drawerFilter, 'mono', filtered && styles.active)}
              onClick={onFilter}
              aria-pressed={filtered}
              aria-describedby="drawer-filter-tip"
            >
              {e.c}
            </button>
            <span id="drawer-filter-tip" role="tooltip" className={styles.tip}>
              {filtered ? 'Click to show all commands again' : `Click to show only ${e.c} calls`}
            </span>
          </span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close details" title="Close (Esc)">
          <Icon.Close />
        </button>
      </div>
      <div className={drawerStyles.drawerBody}>
        <div className={drawerStyles.resultBadge} data-outcome={outcomeOf(e)}>{OUTCOME_LABEL[outcomeOf(e)]}</div>

        <dl className={drawerStyles.facts}>
          <dt>Handler time</dt>
          <dd>
            <span className="mono">{e.ms} ms</span> <span className="muted">· {speed}</span>
          </dd>
          <dt>When</dt>
          <dd title={time.toISOString()}>
            {formatDay(e.t, now)} {time.toLocaleTimeString([], { hour12: false })}.{String(time.getMilliseconds()).padStart(3, '0')}{' '}
            <span className="muted">· {formatAgo(now - e.t)}</span>
          </dd>
          {session && (
            <>
              <dt>Session</dt>
              <dd>
                <span className={cx(styles.sessionInline, styles.sessionFact)} title={[sessionName(session), session.client].filter(Boolean).join(' · ')}>
                  <i className={`sdot hue-${sessionHue(session.id)}`} />
                  <span className={styles.sessionFactName}>{sessionName(session)}</span>
                  {session.client && <span className={cx(styles.sessionFactClient, 'muted')}> · {session.client}</span>}
                </span>
                <span className={cx(styles.sessionSub, 'mono muted')}>{session.id}</span>
              </dd>
            </>
          )}
          {e.src === 'page' && (
            <>
              <dt>Sent from</dt>
              <dd>This page (Snapshots)</dd>
            </>
          )}
          <dt className={drawerStyles.factWide}>Timestamp</dt>
          <dd className={cx(drawerStyles.factWide, 'mono')}>{time.toISOString()}</dd>
          <dt>Sequence</dt>
          <dd className="mono">#{e.n}</dd>
        </dl>

        {e.e && (
          <div className={styles.errorBlock}>
            <div className={styles.errorHead}>
              <span>Error</span>
              <button className="link-btn" onClick={() => copy('error', e.e ?? '')}>
                {copied === 'error' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre>{e.e}</pre>
          </div>
        )}

        <Measurement entry={e} history={history} now={now} onPick={onPick} />
        <EditView.Section entry={e} />

        <div className={drawerStyles.codeBlock}>
          <div className={drawerStyles.codeHead}>
            <span>Params</span>
            {params && (
              <button className="link-btn" onClick={() => copy('params', params)}>
                {copied === 'params' ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          {params ? <ParamsText text={params} onAddTerm={onAddTerm} /> : <pre><span className="muted">No params</span></pre>}
        </div>

        <p className={drawerStyles.drawerHint}>
          <kbd>↑</kbd> <kbd>↓</kbd> to move between commands · select a param to filter by it · <kbd>Esc</kbd> to close
        </p>
      </div>
    </aside>
  );
}

/**
 * The formatted params; selecting text in them offers to filter the log by it (the whole param when the
 * selection sits on one `"key": value` line).
 */
function ParamsText({ text, onAddTerm }: { text: string; onAddTerm: (term: string) => void }) {
  const pre = useRef<HTMLPreElement>(null);
  const [pick, setPick] = useState<{ term: string; x: number; y: number } | null>(null);

  const read = () => {
    const el = pre.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return setPick(null);
    const range = sel.getRangeAt(0);
    const before = document.createRange();
    before.setStart(el, 0);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const term = termFromSelection(text, start, start + range.toString().length);
    const box = range.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    setPick(term ? { term, x: box.left + box.width / 2 - host.left, y: box.top - host.top } : null);
  };

  useEffect(() => {
    // A click elsewhere or a collapsed selection hides the offer
    const onChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setPick(null);
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, []);
  useEffect(() => setPick(null), [text]);

  return (
    <div className={styles.paramsText}>
      <pre ref={pre} onMouseUp={read} onKeyUp={read}>
        {text}
      </pre>
      {pick && (
        <button
          className={styles.paramsFilter}
          style={{ left: pick.x, top: pick.y }}
          // Keep the selection while clicking
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => {
            onAddTerm(pick.term);
            window.getSelection()?.removeAllRanges();
            setPick(null);
          }}
        >
          Filter <span className="mono">{pick.term}</span>
        </button>
      )}
    </div>
  );
}
