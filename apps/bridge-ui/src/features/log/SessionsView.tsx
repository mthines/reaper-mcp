import { formatAgo } from '../../lib/format.js';
import { groupByTool, type CommandEntry } from '../../lib/commands.js';
import { isConnected, sessionHue, sessionName, type Session } from '../../lib/sessions.js';
import { clock } from '../timeline/index.js';
import { cx } from '../../lib/cx.js';
import listStyles from '../../styles/list.module.css';
import styles from './SessionsView.module.css';

/** One card per agent connection, newest activity first. Click one to filter the calls to it. */
export function SessionsView({
  ids,
  sessionOf,
  log,
  now,
  onPick,
}: {
  ids: string[];
  sessionOf: (id: string) => Session;
  log: CommandEntry[];
  now: number;
  onPick: (id: string) => void;
}) {
  // Connected agents first; otherwise keep the stable oldest-first order of `ids`
  const cards = ids.map(sessionOf).sort((a, b) => Number(isConnected(b, now)) - Number(isConnected(a, now)));
  if (cards.length === 0) {
    return (
      <div className={listStyles.rows}>
        <div className={listStyles.empty}>
          No agent sessions yet. Each Claude Code session that connects to the REAPER MCP server shows up here.
        </div>
      </div>
    );
  }
  return (
    <div className={cx(listStyles.rows, styles.sessions)}>
      <p className={styles.sessionsHelp}>
        An agent is one MCP server, usually one Claude Code session; agents in the same folder are numbered by start
        time. It pings every 20s and shows as idle after 45s without one. Click a card to see only its calls.
      </p>
      {cards.map((x) => {
        const own = log.filter((e) => e.s === x.id);
        const tools = groupByTool(own).slice(0, 4);
        const live = isConnected(x, now);
        return (
          <button key={x.id} className={styles.sessionCard} onClick={() => onPick(x.id)} title="Show this session's calls">
            <div className={styles.sessionTop}>
              <i className={`sdot hue-${sessionHue(x.id)} ${live ? '' : 'sdot-off'}`} />
              <span className={styles.sessionName} title={sessionName(x)}>{sessionName(x)}</span>
              {x.client && <span className={listStyles.tag}>{x.client}</span>}
              <span className={cx(styles.sessionState, live ? styles.on : '')}>{live ? 'Connected' : x.ended ? 'Disconnected' : 'Idle'}</span>
            </div>
            {x.dir && (
              <div className={cx(styles.sessionDir, 'mono')} title={x.dir}>
                {/* rtl + bdi: truncate the start of the path so the folder at the end stays visible */}
                <bdi>{x.dir}</bdi>
              </div>
            )}
            <div className={styles.sessionFacts}>
              <span><b>{(x.commands || own.length).toLocaleString()}</b> calls</span>
              <span className={x.errors ? 'tone-bad' : ''}><b>{x.errors.toLocaleString()}</b> errors</span>
              {x.first > 0 && <span>started {clock(x.first)}</span>}
              {x.last > 0 && <span>active {formatAgo(now - x.last)}</span>}
            </div>
            {tools.length > 0 && (
              <div className={styles.sessionTools}>
                {tools.map((g) => (
                  <span key={g.c} className={cx(styles.toolChip, 'mono')}>
                    <i className="kdot" data-kind={g.kind} />
                    {g.c} <span className="muted">×{g.count}</span>
                  </span>
                ))}
              </div>
            )}
            <span className={cx(styles.sessionId, 'mono')}>{x.id}</span>
          </button>
        );
      })}
    </div>
  );
}
