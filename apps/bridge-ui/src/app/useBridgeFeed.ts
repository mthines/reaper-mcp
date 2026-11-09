import { useEffect, useRef, useState } from 'react';
import { parseExtStateReply, parseHistoryReply, parseLogReply, parseLongHistoryReply, parseOlderReply, statusRequestUrl, type BridgeStatus } from '../lib/status.js';
import { DEMO } from './demo-mode.js';
import { load, save } from '../lib/storage.js';
import { fetchText } from '../lib/fetch-text.js';
import { LOG_MAX, mergeLog, restoreLog, type OlderPage, type SavedLog } from '../lib/log.js';
import type { BridgeHistory, LongHistory } from '../lib/timeline.js';
import type { CommandEntry } from '../lib/commands.js';

const POLL_MS = 500;
/** While hidden (minimized, or covered on macOS), keep pinging ui_seen slowly so the bridge knows we're open. */
const HIDDEN_POLL_MS = 2000;

interface Feed {
  status: BridgeStatus | null;
  history: BridgeHistory | null;
  /** The day and week timeline tiers, polled every 10s */
  longHistory: LongHistory | null;
  /** Whether REAPER's web server answered at all */
  reachable: boolean;
  /** Local clock when status.ts last changed (liveness) */
  lastChangeAt: number;
  log: CommandEntry[];
  /** Older commands the bridge keeps in segment files: more to load, and whether a load is under way */
  older: { more: boolean; loading: boolean };
}

const LONG_HISTORY_POLL_MS = 10_000;
const CLEARED_KEY = 'mcp-bridge-cleared-through';
/** When the viewer last pressed Clear: the timeline hides bars from before it too */
const CLEARED_AT_KEY = 'mcp-bridge-cleared-at';

/** Poll the bridge's ExtState through REAPER's web interface; pauses while the tab is hidden. */
export function useBridgeFeed(paused: boolean): Feed & { clearLog: () => void; clearedAt: number; loadOlder: () => void } {
  const [feed, setFeed] = useState<Feed>({ status: null, history: null, longHistory: null, reachable: true, lastChangeAt: 0, log: [], older: { more: false, loading: false } });
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  // Highest sequence number cleared by the user. Numbers continue across bridge restarts and the
  // bridge keeps its log, so this is remembered too, or a reload would bring cleared entries back.
  const clearedThroughRef = useRef(Number(load(CLEARED_KEY)) || 0);
  const [clearedAt, setClearedAt] = useState(() => Number(load(CLEARED_AT_KEY)) || 0);
  // The bridge's saved log (ExtState `log`) is requested when the page opens, after a bridge
  // restart, and when the live 50-entry window skipped entries (the page was hidden or paused).
  // Only the answer to the latest request counts, so an older snapshot can't leave a hole.
  const needLogRef = useRef(true);
  const logWantRef = useRef<{ req: number; at: number } | null>(null);
  // Older segments, one request each: `cursor` is the oldest sequence number held so far (the bridge answers with the
  // segment below it), `wanted` is set by the log when the end of its list is about to scroll into view
  const olderRef = useRef<{ cursor: number | null; more: boolean; wanted: boolean; pending: { id: number; at: number } | null }>({
    cursor: null,
    more: false,
    wanted: false,
    pending: null,
  });
  const loadOlder = () => {
    if (olderRef.current.more) olderRef.current.wanted = true;
  };

  useEffect(() => {
    const demo = DEMO;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    let lastLongPoll = -Infinity;

    const apply = (
      status: BridgeStatus | null,
      history: BridgeHistory | null,
      reachable: boolean,
      longHistory?: LongHistory | null,
      saved?: SavedLog | null,
      page?: OlderPage | null,
    ) =>
      setFeed((prev) => {
        const changed = status !== null && status.ts !== prev.status?.ts;
        const restarted = status !== null && prev.status !== null && status.startedAt !== prev.status.startedAt;
        const newest = status?.recent[0]?.n;
        // Numbering went backwards (the bridge's saved files were removed): start over
        const renumbered = newest !== undefined && newest < Math.max(clearedThroughRef.current, restarted ? (prev.log[0]?.n ?? 0) : 0);
        if (renumbered) {
          clearedThroughRef.current = 0;
          olderRef.current = { cursor: null, more: false, wanted: false, pending: null };
          save(CLEARED_KEY, '0');
          save(CLEARED_AT_KEY, '0');
          setClearedAt(0);
        }
        const incoming = status ? status.recent.filter((e) => e.n > clearedThroughRef.current) : [];
        let log = renumbered ? [] : prev.log;
        if (saved && !pausedRef.current && saved.req === String(logWantRef.current?.req)) {
          log = restoreLog(log, saved.entries, clearedThroughRef.current);
          needLogRef.current = false;
          logWantRef.current = null;
          // The segments start below the saved log; a page that already went further down keeps its place
          if (olderRef.current.cursor === null) {
            olderRef.current.cursor = saved.entries.reduce((m, e) => Math.min(m, e.n), Infinity);
            olderRef.current.more = saved.older === true && Number.isFinite(olderRef.current.cursor);
          }
        }
        const pending = olderRef.current.pending;
        if (page && pending && page.req === String(pending.id)) {
          log = restoreLog(log, page.entries, clearedThroughRef.current);
          olderRef.current.cursor = page.entries.reduce((m, e) => Math.min(m, e.n), olderRef.current.cursor ?? Infinity);
          olderRef.current.more = page.more && page.entries.length > 0;
          olderRef.current.pending = null;
          olderRef.current.wanted = false;
        }
        // The page holds as many as it keeps: older segments would only push their own entries out again
        if (log.length >= LOG_MAX) olderRef.current.more = false;
        if (status && !pausedRef.current) {
          const oldest = incoming[incoming.length - 1]?.n;
          if (restarted || (oldest !== undefined && log.length > 0 && oldest > log[0].n + 1)) needLogRef.current = true;
          log = mergeLog(log, incoming);
        }
        return {
          status,
          history,
          longHistory: longHistory === undefined ? prev.longHistory : longHistory,
          reachable,
          lastChangeAt: changed ? Date.now() : prev.lastChangeAt,
          log,
          older: { more: olderRef.current.more, loading: olderRef.current.pending !== null || olderRef.current.wanted },
        };
      });

    const tick = async () => {
      if (demo) {
        if (!document.hidden) {
          const d = demo.tick();
          if (d.log) logWantRef.current = { req: 0, at: 0 };
          apply(d.status, d.history, true, d.longHistory, d.log ? { req: '0', entries: d.log } : undefined);
        }
      } else {
        const now = Date.now();
        const wantLong = now - lastLongPoll >= LONG_HISTORY_POLL_MS;
        // Paused, the log is frozen: ask (again) once resumed
        const wantLog = needLogRef.current && !pausedRef.current;
        // Ask once, then read until the answer arrives; ask again if it hasn't after 5s
        const ask = wantLog && (!logWantRef.current || now - logWantRef.current.at > 5000);
        if (ask) logWantRef.current = { req: now, at: now };
        // An older segment: asked once, read until it arrives, asked again if it hasn't after 5s
        const o = olderRef.current;
        const wantOlder = o.more && o.cursor !== null && (o.wanted || o.pending !== null) && !pausedRef.current;
        const askOlder = wantOlder && (!o.pending || now - o.pending.at > 5000);
        if (askOlder) o.pending = { id: now, at: now };
        const extra = [...(wantLong ? ['history_long'] : []), ...(wantLog ? ['log'] : []), ...(wantOlder ? ['log_page'] : [])];
        const body = await fetchText(statusRequestUrl(now, extra, ask ? now : undefined, askOlder ? `${now}-${o.cursor}` : undefined));
        if (body === null) apply(null, null, false);
        else {
          if (wantLong) lastLongPoll = now;
          apply(
            parseExtStateReply(body),
            parseHistoryReply(body),
            true,
            wantLong ? parseLongHistoryReply(body) : undefined,
            wantLog ? parseLogReply(body) : undefined,
            wantOlder ? parseOlderReply(body) : undefined,
          );
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

  const clearLog = () => {
    const at = Date.now();
    save(CLEARED_AT_KEY, String(at));
    setClearedAt(at);
    setFeed((prev) => {
      clearedThroughRef.current = Math.max(prev.log[0]?.n ?? 0, prev.status?.recent[0]?.n ?? 0);
      save(CLEARED_KEY, String(clearedThroughRef.current));
      return { ...prev, log: [] };
    });
  };

  return { ...feed, clearLog, clearedAt, loadOlder };
}
