import { useEffect, useRef, useState } from 'react';
import type { PluginRow } from './plugins.js';
import { Icon } from '../../components/index.js';
import { cx } from '../../lib/cx.js';
import styles from './TeachMenu.module.css';

export function toastText(copied: string): string {
  const mine = copied.match(/^contribute:(\d+):(filled|paste)$/);
  if (mine) {
    const what = `${mine[1]} record${mine[1] === '1' ? '' : 's'}`;
    return mine[2] === 'filled'
      ? `Opened GitHub with your ${what} · review the file, then propose it`
      : `Your ${what} ${mine[1] === '1' ? 'is' : 'are'} copied · paste over the placeholder on GitHub, then propose it`;
  }
  const paste = ' · paste it into Claude Code';
  const all = copied.match(/^all:[^:]+:(\d+)$/);
  if (all) return `Prompt for ${all[1]} plugin${all[1] === '1' ? '' : 's'} copied${paste}`;
  if (copied.startsWith('group:')) return `Prompt for the unknown ${copied.slice(6)} plugins copied${paste}`;
  return `Prompt copied${paste}`;
}

export interface TeachOption {
  key: string;
  label: string;
  rows: PluginRow[];
}

/** Split button: teach the first non-empty option; the menu offers every option. */
export function TeachMenu({ options, onCopy }: { options: TeachOption[]; onCopy: (key: string, rows: PluginRow[]) => void }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const available = options.filter((o) => o.rows.length > 0);

  useEffect(() => {
    if (!menu) return;
    const close = (ev: Event) => {
      if (ev instanceof KeyboardEvent ? ev.key === 'Escape' : !ref.current?.contains(ev.target as Node)) {
        ev.stopPropagation();
        setMenu(false);
      }
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
    };
  }, [menu]);

  if (available.length === 0) return null;
  const primary = available[0];
  return (
    <div className={styles.split} ref={ref}>
      <button className={cx(styles.knTeachAll, styles.splitMain, 'btn btn-sm')} onClick={() => onCopy(primary.key, primary.rows)} title="Copy a /learn-plugin prompt for these plugins">
        <Icon.Spark /> Teach {primary.rows.length} {primary.label}
      </button>
      {available.length > 1 && (
        <button className={cx(styles.knTeachAll, styles.splitCaret, 'btn btn-sm')} aria-haspopup="menu" aria-expanded={menu} aria-label="More teach options" onClick={() => setMenu((m) => !m)}>
          <Icon.Chevron className={cx(styles.splitChevron, menu ? styles.knChevronOpen : '')} />
        </button>
      )}
      {menu && (
        <div className={styles.splitMenu} role="menu">
          {available.map((o) => (
            <button
              key={o.key}
              role="menuitem"
              onClick={() => {
                setMenu(false);
                onCopy(o.key, o.rows);
              }}
            >
              Teach all {o.rows.length} {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
