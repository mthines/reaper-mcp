import { useEffect, useId, useRef, useState } from 'react';
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
