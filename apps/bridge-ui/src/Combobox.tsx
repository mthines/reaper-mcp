import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { initialHighlight, listKey, opensList, type ComboboxOption } from './combobox-logic.js';

/**
 * A select-like popup list, modelled on LoreKit's Combobox: the trigger is a `button` with
 * `aria-haspopup="listbox"` (not `role="combobox"`, which would promise a text input), the popup
 * is a `listbox` of `option`s with a check on the selected one and an optional hint line, and
 * the highlight moves by `aria-activedescendant` so focus stays on the list while arrowing.
 */
export function Combobox<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
}: {
  /** Accessible name of the control */
  label: string;
  value: T;
  options: ComboboxOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);

  const show = () => {
    setHighlight(initialHighlight(options, value));
    setOpen(true);
  };
  const hide = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const pick = (i: number) => {
    const option = options[i];
    if (option) onChange(option.value);
    hide(true);
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onDown = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-opt-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, id]);

  return (
    <div className={`combo ${className}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="combo-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${label}: ${current?.label ?? value}`}
        onClick={() => (open ? hide(false) : show())}
        onKeyDown={(ev) => {
          if (!open && opensList(ev.key)) {
            ev.preventDefault();
            show();
          }
        }}
      >
        <span>{current?.label ?? value}</span>
        <svg className="combo-chevron" viewBox="0 0 16 16" aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          className="combo-list"
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-opt-${highlight}`}
          onKeyDown={(ev) => {
            const action = listKey(ev.key, highlight, options.length);
            if (action.type === 'none') return;
            if (action.type !== 'close' || ev.key === 'Escape') ev.preventDefault();
            // Escape belongs to the list here, not to the page's own Escape handling
            ev.stopPropagation();
            if (action.type === 'move') setHighlight(action.index);
            else if (action.type === 'select') pick(action.index);
            else hide(ev.key === 'Escape');
          }}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`combo-option ${i === highlight ? 'combo-option-hl' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => pick(i)}
            >
              <span className="combo-check" aria-hidden>
                {o.value === value && (
                  <svg viewBox="0 0 16 16">
                    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="combo-text">
                <span className="combo-label">{o.label}</span>
                {o.hint && <span className="combo-hint">{o.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface GroupedComboboxItem {
  key: string;
  label: ReactNode;
  hint?: string;
  /** A choice in its group (checked when true); undefined for an action */
  selected?: boolean;
  disabled?: boolean;
  onPick: () => void;
}

/**
 * The Combobox in groups, for a toolbar folded into one control: each group is a headed `group` of
 * `option`s in the one listbox, choices carry the check, actions run and close. Opens fixed under the
 * trigger so a panel with `overflow: hidden` can't clip it.
 */
export function GroupedCombobox({
  label,
  triggerLabel,
  groups,
  className = '',
}: {
  /** Accessible name of the control */
  label: string;
  /** What the trigger shows: the current choices */
  triggerLabel: string;
  groups: Array<{ label: string; items: GroupedComboboxItem[] }>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [at, setAt] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const shown = groups.filter((g) => g.items.length > 0);
  const items = shown.flatMap((g) => g.items);

  const show = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, left: r.left });
    setHighlight(Math.max(0, items.findIndex((it) => it.selected)));
    setOpen(true);
  };
  const hide = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const pick = (i: number) => {
    const item = items[i];
    if (!item || item.disabled) return;
    hide(true);
    item.onPick();
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onDown = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-opt-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, id]);

  let index = 0;
  return (
    <div className={`combo ${className}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="combo-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${label}: ${triggerLabel}`}
        onClick={() => (open ? hide(false) : show())}
        onKeyDown={(ev) => {
          if (!open && opensList(ev.key)) {
            ev.preventDefault();
            show();
          }
        }}
      >
        <span className="combo-trigger-text">{triggerLabel}</span>
        <svg className="combo-chevron" viewBox="0 0 16 16" aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          id={`${id}-list`}
          className="combo-list combo-list-fixed"
          style={{ top: at.top, left: at.left, maxHeight: `calc(100vh - ${at.top + 8}px)` }}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-opt-${highlight}`}
          onKeyDown={(ev) => {
            const action = listKey(ev.key, highlight, items.length);
            if (action.type === 'none') return;
            if (action.type !== 'close' || ev.key === 'Escape') ev.preventDefault();
            // Escape belongs to the list here, not to the page's own Escape handling
            ev.stopPropagation();
            if (action.type === 'move') setHighlight(action.index);
            else if (action.type === 'select') pick(action.index);
            else hide(ev.key === 'Escape');
          }}
        >
          {shown.map((g) => (
            <div key={g.label} role="group" aria-labelledby={`${id}-g-${g.label}`} className="combo-group">
              <div id={`${id}-g-${g.label}`} role="presentation" className="combo-heading">
                {g.label}
              </div>
              {g.items.map((it) => {
                const i = index++;
                return (
                  <div
                    key={it.key}
                    id={`${id}-opt-${i}`}
                    role="option"
                    aria-selected={it.selected === true}
                    aria-disabled={it.disabled || undefined}
                    className={`combo-option ${i === highlight ? 'combo-option-hl' : ''} ${it.disabled ? 'combo-option-off' : ''}`}
                    onMouseEnter={() => setHighlight(i)}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => pick(i)}
                  >
                    <span className="combo-check" aria-hidden>
                      {it.selected && (
                        <svg viewBox="0 0 16 16">
                          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="combo-text">
                      <span className="combo-label">{it.label}</span>
                      {it.hint && <span className="combo-hint">{it.hint}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
