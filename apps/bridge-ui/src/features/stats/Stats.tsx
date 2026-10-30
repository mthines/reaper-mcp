import { useState, type ReactNode } from 'react';
import type { BridgeStatus } from '../../lib/status.js';
import { Sparkline } from './Sparkline.js';
import { load, save } from '../../lib/storage.js';
import { commandsPerMinute, latencyStats, type Series } from '../../lib/log.js';
import { formatDuration, formatMs } from '../../lib/format.js';
import type { CommandEntry } from '../../lib/commands.js';

const STATS_OPEN_KEY = 'mcp-bridge-stats-open';

/** On narrow screens the stats fold into one compact row (label + value); the toggle shows hints and sparklines. */
export function Stats({ status, log, now, series }: { status: BridgeStatus; log: CommandEntry[]; now: number; series: Series }) {
  const lat = latencyStats(status.recent);
  const errorRate = status.commands > 0 ? (status.errors / status.commands) * 100 : 0;
  const [open, setOpen] = useState(() => load(STATS_OPEN_KEY) === '1');
  const toggle = () => {
    save(STATS_OPEN_KEY, open ? '0' : '1');
    setOpen(!open);
  };
  return (
    <section className={`stats ${open ? '' : 'stats-folded'}`}>
      <button
        type="button"
        className="stats-toggle"
        aria-expanded={open}
        aria-label={open ? 'Show fewer stats' : 'Show stat details'}
        title={open ? 'Show fewer stats' : 'Show stat details'}
        onClick={toggle}
      >
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d={open ? 'M3 7.5 6 4.5 9 7.5' : 'M3 4.5 6 7.5 9 4.5'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
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
