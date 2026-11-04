import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatShortcut } from './shortcut.js';
import { entriesOf, groupEntries, searchEntries, type Entry } from './search.js';
import type { Command } from './types.js';
import { cx } from '../../lib/cx.js';
import styles from './CommandPalette.module.css';

/** ⌘K: search every registered command, ↑/↓ to move, Enter to run, Esc to go back or close. A command with `children` opens its list. */
export function CommandPalette({ commands, closing, onClose }: { commands: Command[]; closing: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  // Drilled-in commands ("Rename snapshot…"), newest last
  const [stack, setStack] = useState<Command[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const parent = stack[stack.length - 1] ?? null;
  const level = parent?.children ?? commands;
  // A search reaches into the menus: their sub items are listed with the menu named
  const found = useMemo(() => searchEntries(entriesOf(level, query.trim() !== ''), query), [level, query]);
  const groups = useMemo(() => groupEntries(found, query), [found, query]);
  const flat = groups.flatMap((g) => g.entries);
  const current = Math.min(active, flat.length - 1);

  useEffect(() => {
    input.current?.focus();
    // Hand focus back to what had it before, unless a command that just ran has moved it (search)
    const before = document.activeElement as HTMLElement | null;
    return () => {
      if (!document.activeElement || document.activeElement === document.body) before?.focus?.();
    };
  }, []);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current, flat.length]);

  const run = ({ command: c }: Entry) => {
    if (c.children) {
      setStack([...stack, c]);
      setQuery('');
      setActive(0);
    } else {
      onClose();
      // After the palette is gone, so a command that moves focus (search) keeps it
      queueMicrotask(() => c.onSelect?.());
    }
  };
  const back = () => {
    if (stack.length) {
      setStack(stack.slice(0, -1));
      setQuery('');
      setActive(0);
    } else onClose();
  };
  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (flat.length) setActive((current + (ev.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const e = flat[current];
      if (e) run(e);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      back();
    } else if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      // Only when the caret has nowhere left to go in that direction, so editing the search still works
      const el = ev.currentTarget.querySelector('input');
      if (!el || el.selectionStart !== el.selectionEnd) return;
      const atEnd = el.selectionStart === el.value.length;
      const atStart = el.selectionStart === 0;
      const e = flat[current];
      if (ev.key === 'ArrowRight' && atEnd && e?.command.children) {
        ev.preventDefault();
        run(e);
      } else if (ev.key === 'ArrowLeft' && atStart && stack.length) {
        ev.preventDefault();
        back();
      }
    } else if (ev.key === 'Backspace' && !query && stack.length) {
      back();
    }
  };

  return (
    <div className={cx(styles.scrim, closing && styles.leaving)} onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className={styles.inputRow}>
          {parent && (
            <button className={styles.crumb} onClick={back} title="Back (Esc)">
              {parent.label.replace(/…$/, '')}
            </button>
          )}
          <input
            ref={input}
            className={styles.input}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={flat[current] ? `${id}-${flat[current].command.id}` : undefined}
            aria-label="Search commands"
            placeholder={parent ? parent.label.replace(/…$/, '') : 'Type a command or search…'}
            value={query}
            onChange={(ev) => {
              setQuery(ev.target.value);
              setActive(0);
            }}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className={styles.list} role="listbox" id={`${id}-list`} ref={listRef}>
          {flat.length === 0 && <div className={styles.empty}>No command matches “{query.trim()}”.</div>}
          {groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label}>
              <div className={styles.groupLabel}>{g.label}</div>
              {g.entries.map((entry) => {
                const { command: c, trail } = entry;
                const mine = flat.indexOf(entry);
                const menu = c.children !== undefined;
                return (
                  <div
                    key={c.id}
                    id={`${id}-${c.id}`}
                    role="option"
                    aria-selected={mine === current}
                    aria-haspopup={menu ? 'menu' : undefined}
                    data-menu={menu ? '' : undefined}
                    className={styles.row}
                    onMouseMove={() => mine !== current && setActive(mine)}
                    onClick={() => run(entry)}
                  >
                    {c.icon && <span className={styles.icon}>{c.icon}</span>}
                    <span className={styles.label}>
                      {trail && <span className={styles.trail}>{trail} › </span>}
                      {c.label}
                    </span>
                    {c.shortcut ? (
                      <kbd className={styles.kbd}>{formatShortcut(c.shortcut)}</kbd>
                    ) : c.hint ? (
                      <kbd className={styles.kbd}>{c.hint}</kbd>
                    ) : null}
                    {menu && (
                      <span className={styles.menuMark} title="Opens a menu">
                        {c.children?.length}
                        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className={styles.foot}>
          <span><kbd className={styles.kbd}>↑↓</kbd> move</span>
          <span><kbd className={styles.kbd}>↵</kbd> run</span>
          <span><kbd className={styles.kbd}>←→</kbd> menus</span>
          <span><kbd className={styles.kbd}>Esc</kbd> {stack.length ? 'back' : 'close'}</span>
        </div>
      </div>
    </div>
  );
}
