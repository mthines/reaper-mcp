import { useEffect, useRef } from 'react';
import { entriesOf } from './search.js';
import { formatShortcut } from './shortcut.js';
import type { Command } from './types.js';
import { cx } from '../../lib/cx.js';
import styles from './CommandPalette.module.css';

/** `?`: every registered shortcut, from the live registry, so a new command shows up here with nothing else to edit */
export function ShortcutHelp({ commands, closing, onClose }: { commands: Command[]; closing: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => before?.focus?.();
  }, []);
  // Keys of sub items too (Shift+1–9 on the snapshots menu)
  const bound = entriesOf(commands, true).map((e) => e.command).filter((c) => c.shortcut || c.hint);
  const groups = new Map<string, Command[]>();
  for (const c of bound) groups.set(c.group ?? 'Commands', [...(groups.get(c.group ?? 'Commands') ?? []), c]);
  return (
    <div className={cx(styles.scrim, closing && styles.leaving)} onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className={styles.helpHead}>
          <b>Keyboard shortcuts</b>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
        </div>
        <div className={styles.helpBody}>
          {[...groups].map(([group, list]) => (
            <section key={group} aria-label={group}>
              <div className={styles.groupLabel}>{group}</div>
              {list.map((c) => (
                <div key={c.id} className={styles.helpRow}>
                  <span className={styles.label}>{c.label}</span>
                  <kbd className={styles.kbd}>{c.shortcut ? formatShortcut(c.shortcut) : c.hint}</kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
