/**
 * Keyboard logic for Combobox.tsx, kept pure so it is testable without a browser
 * (the same split as LoreKit's combobox-logic.ts).
 */

export interface ComboboxOption<T extends string> {
  value: T;
  label: string;
  /** Second line of muted text, e.g. "10 s per bar" */
  hint?: string;
}

export type ComboboxKeyResult =
  | { type: 'move'; index: number }
  | { type: 'select'; index: number }
  | { type: 'close' }
  | { type: 'none' };

/** Where the highlight starts when the list opens: the selected option, else the first. */
export function initialHighlight<T extends string>(options: ComboboxOption<T>[], value: T): number {
  return Math.max(0, options.findIndex((o) => o.value === value));
}

/** What a key does while the list is open. Arrows clamp at the ends rather than wrap. */
export function listKey(key: string, highlight: number, count: number): ComboboxKeyResult {
  if (count === 0) return key === 'Escape' || key === 'Tab' ? { type: 'close' } : { type: 'none' };
  switch (key) {
    case 'ArrowDown':
      return { type: 'move', index: Math.min(count - 1, highlight + 1) };
    case 'ArrowUp':
      return { type: 'move', index: Math.max(0, highlight - 1) };
    case 'Home':
      return { type: 'move', index: 0 };
    case 'End':
      return { type: 'move', index: count - 1 };
    case 'Enter':
    case ' ':
      return { type: 'select', index: highlight };
    case 'Escape':
    case 'Tab':
      return { type: 'close' };
    default:
      return { type: 'none' };
  }
}

/** Keys that open the list from the closed trigger. */
export function opensList(key: string): boolean {
  return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ';
}
