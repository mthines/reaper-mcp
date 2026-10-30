import { clock } from '../timeline/Timeline.js';
import { formatAgo } from '../../lib/format.js';
import { groupByTool, type CommandEntry } from '../../lib/commands.js';
import { isConnected, sessionHue, sessionName, type Session } from '../../lib/sessions.js';

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
      <div className="rows">
        <div className="empty">
          No agent sessions yet. Each Claude Code session that connects to the REAPER MCP server shows up here.
        </div>
      </div>
    );
  }
  return (
    <div className="rows sessions">
      <p className="sessions-help">
        An agent is one MCP server, usually one Claude Code session; agents in the same folder are numbered by start
        time. It pings every 20s and shows as idle after 45s without one. Click a card to see only its calls.
      </p>
      {cards.map((x) => {
        const own = log.filter((e) => e.s === x.id);
        const tools = groupByTool(own).slice(0, 4);
        const live = isConnected(x, now);
        return (
          <button key={x.id} className="session-card" onClick={() => onPick(x.id)} title="Show this session's calls">
            <div className="session-top">
              <i className={`sdot hue-${sessionHue(x.id)} ${live ? '' : 'sdot-off'}`} />
              <span className="session-name" title={sessionName(x)}>{sessionName(x)}</span>
              {x.client && <span className="tag">{x.client}</span>}
              <span className={`session-state ${live ? 'on' : ''}`}>{live ? 'Connected' : x.ended ? 'Disconnected' : 'Idle'}</span>
            </div>
            {x.dir && (
              <div className="session-dir mono" title={x.dir}>
                {/* rtl + bdi: truncate the start of the path so the folder at the end stays visible */}
                <bdi>{x.dir}</bdi>
              </div>
            )}
            <div className="session-facts">
              <span><b>{(x.commands || own.length).toLocaleString()}</b> calls</span>
              <span className={x.errors ? 'tone-bad' : ''}><b>{x.errors.toLocaleString()}</b> errors</span>
              {x.first > 0 && <span>started {clock(x.first)}</span>}
              {x.last > 0 && <span>active {formatAgo(now - x.last)}</span>}
            </div>
            {tools.length > 0 && (
              <div className="session-tools">
                {tools.map((g) => (
                  <span key={g.c} className="tool-chip mono">
                    <i className={`kdot kind-${g.kind}`} />
                    {g.c} <span className="muted">×{g.count}</span>
                  </span>
                ))}
              </div>
            )}
            <span className="session-id mono">{x.id}</span>
          </button>
        );
      })}
    </div>
  );
}
