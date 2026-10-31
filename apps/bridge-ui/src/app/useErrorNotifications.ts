import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { load, save } from '../lib/storage.js';
import { sessionName, type Session } from '../lib/sessions.js';
import { outcomeOf, type CommandEntry } from '../lib/commands.js';

const NOTIFY_KEY = 'mcp-bridge-notify';
/** Desktop notification per failed command while enabled (a per-viewer choice, kept in localStorage). */
export function useErrorNotifications(log: CommandEntry[], sessions: Map<string, Session>) {
  const [enabled, setEnabled] = useState(() => load(NOTIFY_KEY) === '1' && notificationPermission() === 'granted');
  const notifiedThrough = useRef(log[0]?.n ?? 0);

  const nameOf = useEffectEvent((id: string) => sessionName(sessions.get(id) ?? { id }));
  useEffect(() => {
    const newest = log[0]?.n ?? 0;
    if (enabled) {
      // Refused requests are expected (a warning), so only system errors reach the desktop
      const fresh = log.filter((e) => e.n > notifiedThrough.current && outcomeOf(e) === 'error');
      // A burst collapses into one notification so a failing loop can't flood the desktop
      if (fresh.length > 3) {
        new Notification(`MCP Bridge: ${fresh.length} commands failed`, { body: fresh[0].e, tag: 'mcp-bridge-errors' });
      } else {
        for (const e of fresh.reverse()) {
          const who = e.s ? ` · ${nameOf(e.s)}` : '';
          new Notification(`${e.c} failed${who}`, { body: e.e, tag: `mcp-bridge-${e.n}` });
        }
      }
    }
    notifiedThrough.current = Math.max(notifiedThrough.current, newest);
  }, [log, enabled]);

  const toggle = async (on: boolean) => {
    if (on && notificationPermission() !== 'granted') {
      if (notificationPermission() === 'unsupported') return;
      if ((await Notification.requestPermission()) !== 'granted') return;
    }
    setEnabled(on);
    save(NOTIFY_KEY, on ? '1' : '0');
  };
  return [enabled, toggle] as const;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}
