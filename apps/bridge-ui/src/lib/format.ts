

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function formatMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

export function formatAgo(ms: number): string {
  if (ms < 1500) return 'now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

/** Calendar day of `t` relative to `now` (local time): "Today", "Yesterday", else a short date (year only when it differs). */
export function formatDay(t: number, now: number): string {
  const day = new Date(t);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - start.getTime()) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(day.getFullYear() !== today.getFullYear() ? { year: '2-digit' } : {}),
  });
}

/** Pretty-print captured params; the bridge truncates long ones, so fall back to the raw text. */
export function formatParams(p: string | undefined): string | null {
  if (!p) return null;
  try {
    return JSON.stringify(JSON.parse(p), null, 2);
  } catch {
    return `${p}…`;
  }
}
