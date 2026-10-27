import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { createDemo } from './demo.js';
import {
  HISTORY_MAX,
  commandsPerMinute,
  deriveSeries,
  formatAgo,
  formatDuration,
  formatMs,
  latencyStats,
  liveness,
  mergeLog,
  parseExtStateReply,
  statusRequestUrl,
  type BridgeStatus,
  type CommandEntry,
  type Sample,
  type Series,
  type Liveness,
} from './status.js';

const REPO_URL = 'https://github.com/mthines/reaper-mcp';
declare const __VERSION__: string;

const POLL_MS = 500;
/** While hidden (minimized, or covered on macOS), keep pinging ui_seen slowly so the bridge knows we're open. */
const HIDDEN_POLL_MS = 2000;
const SLOW_MS = 100;
const VERY_SLOW_MS = 500;

interface Feed {
  status: BridgeStatus | null;
  /** Whether REAPER's web server answered at all */
  reachable: boolean;
  /** Local clock when status.ts last changed (liveness) */
  lastChangeAt: number;
  log: CommandEntry[];
}

/** Poll the bridge's ExtState through REAPER's web interface; pauses while the tab is hidden. */
function useBridgeFeed(paused: boolean): Feed {
  const [feed, setFeed] = useState<Feed>({ status: null, reachable: true, lastChangeAt: 0, log: [] });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const demo = new URLSearchParams(location.search).has('demo') ? createDemo() : null;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const apply = (status: BridgeStatus | null, reachable: boolean) =>
      setFeed((prev) => {
        const changed = status !== null && status.ts !== prev.status?.ts;
        const restarted = status !== null && prev.status !== null && status.startedAt !== prev.status.startedAt;
        const base = restarted ? [] : prev.log;
        return {
          status,
          reachable,
          lastChangeAt: changed ? Date.now() : prev.lastChangeAt,
          log: status && !pausedRef.current ? mergeLog(base, status.recent) : base,
        };
      });

    const tick = async () => {
      if (demo) {
        if (!document.hidden) apply(demo(), true);
      } else {
        try {
          const res = await fetch(statusRequestUrl(Date.now()), { cache: 'no-store' });
          apply(parseExtStateReply(await res.text()), true);
        } catch {
          apply(null, false);
        }
      }
      if (!cancelled) timer = setTimeout(tick, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return feed;
}

/** Snapshot the bridge's cumulative counters once per tick for the stat sparklines. */
function useHistory(status: BridgeStatus | null, now: number): Sample[] {
  const [samples, setSamples] = useState<Sample[]>([]);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const st = statusRef.current;
    if (!st) return;
    setSamples((prev) => {
      const last = prev[prev.length - 1];
      // Bridge restarted: counters reset, start a fresh history
      const base = last && st.commands < last.commands ? [] : prev;
      return [...base, { t: now, commands: st.commands, errors: st.errors, deferMs: st.deferMs }].slice(-HISTORY_MAX);
    });
  }, [now]);

  return samples;
}

/** Re-render on a fixed cadence for relative times / uptime. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function App() {
  const [paused, setPaused] = useState(false);

  // Opened by the bridge as a Chromium --app window: settle on a compact size once
  useEffect(() => {
    if (new URLSearchParams(location.search).has('app') && window.outerWidth > 1100) {
      window.resizeTo(980, 720);
    }
  }, []);
  const { status, reachable, lastChangeAt, log } = useBridgeFeed(paused);
  const now = useNow(1000);
  const state: Liveness = liveness(status, lastChangeAt, now);
  const samples = useHistory(status, now);
  const series = useMemo(() => deriveSeries(samples, log), [samples, log]);

  useEffect(() => {
    document.title = `${state === 'live' ? '●' : '○'} MCP Bridge`;
  }, [state]);

  return (
    <div className="shell">
      <Header status={status} state={state} reachable={reachable} />
      {status ? (
        <>
          <Stats status={status} log={log} now={now} series={series} />
          <Activity log={log} />
          <Log log={log} paused={paused} onTogglePause={() => setPaused((p) => !p)} now={now} />
          <footer className="footer">
            <span className="mono" title="Bridge IPC directory">{status.bridgeDir}</span>
            <span className="footer-meta">
              Updated {formatAgo(now - lastChangeAt)}
              <span className="dot-sep" />
              <a href={REPO_URL} target="_blank" rel="noreferrer">reaper-mcp v{__VERSION__}</a>
              <span className="dot-sep" />
              <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">Report an issue</a>
            </span>
          </footer>
        </>
      ) : (
        <Offline reachable={reachable} />
      )}
    </div>
  );
}

function Header({ status, state, reachable }: { status: BridgeStatus | null; state: Liveness; reachable: boolean }) {
  const label = state === 'live' ? 'Live' : state === 'stale' ? 'Not responding' : reachable ? 'Bridge stopped' : 'REAPER unreachable';
  return (
    <header className="header">
      <div className="brand">
        <Mark active={state === 'live'} />
        <div>
          <h1>MCP Bridge</h1>
          <p className="sub">
            {status ? (
              <>
                {status.project || 'Unsaved project'}
                <span className="dot-sep" />
                REAPER {status.reaperVersion.split('/')[0]}
              </>
            ) : (
              'reaper-mcp'
            )}
          </p>
        </div>
      </div>
      <div className="header-actions">
        <span className={`pill pill-${state}`}>
          <span className="pill-dot" />
          {label}
        </span>
        <a className="icon-link" href={REPO_URL} target="_blank" rel="noreferrer" title="reaper-mcp on GitHub" aria-label="reaper-mcp on GitHub">
          <GitHubIcon />
        </a>
      </div>
    </header>
  );
}

function Mark({ active }: { active: boolean }) {
  return (
    <div className={`mark ${active ? 'mark-active' : ''}`} aria-hidden>
      {[0.45, 0.8, 1, 0.65, 0.35].map((h, i) => (
        <span key={i} style={{ '--h': h, '--i': i } as CSSProperties} />
      ))}
    </div>
  );
}

function Stats({ status, log, now, series }: { status: BridgeStatus; log: CommandEntry[]; now: number; series: Series }) {
  const lat = latencyStats(status.recent);
  const errorRate = status.commands > 0 ? (status.errors / status.commands) * 100 : 0;
  return (
    <section className="stats">
      <Stat
        label="Uptime"
        value={formatDuration(now - status.startedAt)}
        hint={`since ${new Date(status.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`}
      />
      <Stat
        label="Commands"
        value={status.commands.toLocaleString()}
        hint={`${commandsPerMinute(log, now)} / min`}
        spark={<Sparkline values={series.commands} floor={2} tone="accent" label="commands per second" variant="bars" format={(v) => `${v} cmd`} />}
      />
      <Stat
        label="Errors"
        value={status.errors.toLocaleString()}
        hint={status.commands > 0 ? `${errorRate.toFixed(1)}%` : '—'}
        tone={status.errors > 0 ? 'bad' : undefined}
        spark={<Sparkline values={series.errors} floor={2} tone={series.errors.some((v) => v > 0) ? 'bad' : 'muted'} label="errors per second" variant="bars" format={(v) => `${v} error${v === 1 ? '' : 's'}`} />}
      />
      <Stat
        label="Latency"
        value={lat ? formatMs(lat.avg) : '—'}
        hint={lat ? `p95 ${formatMs(lat.p95)}` : 'avg handler'}
        spark={<Sparkline values={series.latency} floor={5} tone="accent" label="avg handler ms" format={formatMs} />}
      />
      <Stat
        label="Loop"
        value={status.deferMs > 0 ? formatMs(status.deferMs) : '—'}
        hint="defer cycle"
        tone={status.deferMs > 100 ? 'warn' : undefined}
        spark={<Sparkline values={series.loop} floor={40} tone={status.deferMs > 100 ? 'warn' : 'muted'} label="defer cycle ms" format={formatMs} />}
      />
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  spark,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'bad' | 'warn';
  spark?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone ? `tone-${tone}` : ''}`}>{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
      {spark && <div className="stat-spark">{spark}</div>}
    </div>
  );
}

const SPARK_W = 100;
const SPARK_H = 24;

/**
 * Last-minute trend, one slot per second, newest on the right. `floor` is the minimum y-range
 * so quiet periods read as a flat baseline instead of noise blown up to full height.
 * Counts render as bars; the line variant connects across seconds with no data (null).
 * Hover shows the value at that second; the guide/dot are HTML so they don't stretch with the SVG.
 */
function Sparkline({
  values,
  floor,
  tone,
  label,
  format,
  variant = 'line',
}: {
  values: Array<number | null>;
  floor: number;
  tone: 'accent' | 'bad' | 'warn' | 'muted';
  label: string;
  format: (v: number) => string;
  variant?: 'line' | 'bars';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const slots = HISTORY_MAX - 1;
  const max = Math.max(floor, ...values.map((v) => v ?? 0)) * 1.15;
  const slotW = SPARK_W / slots;
  const offset = slots - values.length;
  const y = (v: number) => SPARK_H - 1 - (v / max) * (SPARK_H - 3);

  const onMove = (ev: MouseEvent<HTMLDivElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const i = Math.floor(((ev.clientX - rect.left) / rect.width) * slots) - offset;
    setHover(i >= 0 && i < values.length ? i : null);
  };

  let body: ReactNode;
  if (variant === 'bars') {
    body = values.map((v, i) =>
      v ? (
        <rect
          key={i}
          className={`spark-bar ${hover === i ? 'spark-bar-hover' : ''}`}
          x={(offset + i) * slotW + slotW * 0.15}
          width={slotW * 0.7}
          y={y(v)}
          height={SPARK_H - y(v)}
          rx={0.4}
        />
      ) : null,
    );
  } else {
    const pts = values.flatMap((v, i) => (v === null ? [] : [[(offset + i + 0.5) * slotW, y(v)] as const]));
    if (pts.length > 0) {
      const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)}`).join('');
      body = <path className="spark-line" d={pts.length > 1 ? line : `M${pts[0][0]},${pts[0][1]}h0.01`} />;
    }
  }

  const hv = hover === null ? undefined : values[hover];
  const leftPct = hover === null ? 0 : ((offset + hover + 0.5) / slots) * 100;
  const ago = hover === null ? 0 : values.length - 1 - hover;
  const tipAlign = leftPct < 18 ? 'start' : leftPct > 82 ? 'end' : 'center';

  return (
    <div className={`spark-wrap spark-${tone}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg className="spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" role="img" aria-label={`${label}, last minute`}>
        <line className="spark-base" x1="0" x2={SPARK_W} y1={SPARK_H - 0.5} y2={SPARK_H - 0.5} />
        {body}
      </svg>
      {hover !== null && (
        <>
          <span className="spark-guide" style={{ left: `${leftPct}%` }} />
          {variant === 'line' && hv != null && (
            <span className="spark-dot" style={{ left: `${leftPct}%`, top: `${(y(hv) / SPARK_H) * 100}%` }} />
          )}
          <span className={`spark-tip spark-tip-${tipAlign}`} style={{ left: `${leftPct}%` }}>
            <b>{hv == null ? 'no commands' : format(hv)}</b>
            <span>{ago === 0 ? 'now' : `${ago}s ago`}</span>
          </span>
        </>
      )}
    </div>
  );
}

const ACTIVITY_BARS = 90;

/** Log-scaled so 1 ms and 500 ms both read. */
const latencyScale = (ms: number) => Math.min(1, Math.max(0.06, Math.log10(1 + ms) / Math.log10(1 + VERY_SLOW_MS)));

/** Handler time per command, oldest → newest. */
function Activity({ log }: { log: CommandEntry[] }) {
  const entries = log.slice(0, ACTIVITY_BARS).reverse();
  return (
    <section className="activity" aria-label="Recent command latency">
      <div className="activity-head">
        <span>Handler latency · last {entries.length} commands</span>
        <span className="legend">
          <i className="lg lg-ok" /> ok
          <i className="lg lg-slow" /> ≥ {SLOW_MS} ms
          <i className="lg lg-err" /> error
        </span>
      </div>
      <div className="bars">
        {entries.map((e) => (
          <span
            key={e.n}
            className={`bar ${!e.ok ? 'bar-err' : e.ms >= SLOW_MS ? 'bar-slow' : ''}`}
            style={{ height: `${latencyScale(e.ms) * 100}%` }}
            title={`#${e.n} ${e.c} · ${formatMs(e.ms)}${e.ok ? '' : ' · error'}`}
          />
        ))}
      </div>
    </section>
  );
}

type Filter = 'all' | 'errors';

function Log({
  log,
  paused,
  onTogglePause,
  now,
}: {
  log: CommandEntry[];
  paused: boolean;
  onTogglePause: () => void;
  now: number;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === '/' && document.activeElement !== searchRef.current) {
        ev.preventDefault();
        searchRef.current?.focus();
      } else if (ev.key === 'Escape') {
        setQuery('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const errorCount = useMemo(() => log.filter((e) => !e.ok).length, [log]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return log.filter(
      (e) => (filter === 'all' || !e.ok) && (!q || e.c.toLowerCase().includes(q) || e.e?.toLowerCase().includes(q)),
    );
  }, [log, filter, query]);

  const copy = async () => {
    const text = rows
      .map((e) => `${new Date(e.t).toISOString()}  #${e.n}  ${e.ok ? 'ok ' : 'ERR'}  ${e.c}  ${e.ms}ms${e.e ? `  ${e.e}` : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard needs a secure context (localhost is fine; LAN IPs are not)
    }
  };

  return (
    <section className="log">
      <div className="toolbar">
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>
            All <span className="count">{log.length}</span>
          </button>
          <button role="tab" aria-selected={filter === 'errors'} onClick={() => setFilter('errors')}>
            Errors <span className={`count ${errorCount ? 'count-bad' : ''}`}>{errorCount}</span>
          </button>
        </div>
        <label className="search">
          <SearchIcon />
          <input
            ref={searchRef}
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            placeholder="Filter commands or errors"
            spellCheck={false}
          />
          {!query && <kbd>/</kbd>}
        </label>
        <div className="actions">
          <button className={`btn ${paused ? 'btn-on' : ''}`} onClick={onTogglePause} title="Freeze the log to read it">
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="btn" onClick={copy} disabled={rows.length === 0} title="Copy visible rows">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="rows" role="log" aria-live="off">
        {rows.length === 0 ? (
          <div className="empty">
            {log.length === 0
              ? 'Waiting for the first command from your agent…'
              : filter === 'errors' && !query
                ? 'No errors. Nice.'
                : 'Nothing matches that filter.'}
          </div>
        ) : (
          rows.map((e) => (
            <Row key={e.n} entry={e} now={now} open={open === e.n} onToggle={() => setOpen(open === e.n ? null : e.n)} />
          ))
        )}
      </div>
      {paused && <div className="paused-banner">Paused · new commands are still counted, the log is frozen</div>}
    </section>
  );
}

function Row({ entry: e, now, open, onToggle }: { entry: CommandEntry; now: number; open: boolean; onToggle: () => void }) {
  const time = new Date(e.t);
  const hhmmss = time.toLocaleTimeString([], { hour12: false });
  const ms = String(time.getMilliseconds()).padStart(3, '0');
  const speed = e.ms >= VERY_SLOW_MS ? 'very-slow' : e.ms >= SLOW_MS ? 'slow' : '';
  return (
    <div className={`row ${e.ok ? '' : 'row-err'} ${open ? 'row-open' : ''}`}>
      <button className="row-main" onClick={onToggle} aria-expanded={open}>
        <span className="row-time mono" title={formatAgo(now - e.t)}>
          {hhmmss}
          <span className="row-ms">.{ms}</span>
        </span>
        <span className={`status-dot ${e.ok ? 'ok' : 'err'}`} />
        <span className="row-cmd mono">{e.c}</span>
        {e.e && !open && <span className="row-err-inline">{e.e}</span>}
        <span className={`row-dur mono ${speed}`}>
          <span className="dur-track" aria-hidden>
            <span className="dur-fill" style={{ width: `${latencyScale(e.ms) * 100}%` }} />
          </span>
          {formatMs(e.ms)}
        </span>
      </button>
      {open && (
        <dl className="detail mono">
          <dt>seq</dt>
          <dd>#{e.n}</dd>
          <dt>time</dt>
          <dd>{time.toISOString()}</dd>
          <dt>handler</dt>
          <dd>{e.ms} ms</dd>
          <dt>result</dt>
          <dd>{e.ok ? 'success' : 'error'}</dd>
          {e.e && (
            <>
              <dt>error</dt>
              <dd className="detail-err">{e.e}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function Offline({ reachable }: { reachable: boolean }) {
  return (
    <section className="offline">
      <div className="offline-icon" aria-hidden>
        <Mark active={false} />
      </div>
      {reachable ? (
        <>
          <h2>The bridge isn’t running</h2>
          <p>REAPER is up, but <code>mcp_bridge.lua</code> hasn’t published a status yet.</p>
          <ol>
            <li>In REAPER: Actions → Show action list → Load ReaScript…</li>
            <li>Select <code>Scripts/mcp_bridge.lua</code> and run it</li>
            <li>This page connects on its own. No reload needed.</li>
          </ol>
        </>
      ) : (
        <>
          <h2>Can’t reach REAPER</h2>
          <p>This page talks to REAPER through its built-in web interface.</p>
          <ol>
            <li>Make sure REAPER is open</li>
            <li>Preferences → Control/OSC/Web → Add → Web browser interface</li>
            <li>Open <code>http://localhost:&lt;port&gt;/mcp_bridge.html</code></li>
          </ol>
        </>
      )}
    </section>
  );
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
