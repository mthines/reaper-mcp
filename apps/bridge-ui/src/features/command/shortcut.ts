/**
 * Keyboard shortcut engine (ported from LoreKit web): single keys (`'f'`), chords pressed in order within
 * CHORD_TIMEOUT_MS (`['g', 'c']`), and modifiers with `+` (`'mod+k'`; `mod` is ⌘ on macOS, Ctrl elsewhere).
 * Pure: the React side is `CommandProvider`.
 */

/** Time window (ms) within which the next key of a chord must arrive */
export const CHORD_TIMEOUT_MS = 1000;

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export interface ParsedKey {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

export function parseKey(token: string): ParsedKey {
  const parts = token.toLowerCase().split('+');
  // `'mod++'` would split into empty parts; a lone '+' key is not used here
  const key = parts[parts.length - 1] ?? '';
  return {
    key,
    mod: parts.includes('mod') || parts.includes('ctrl') || parts.includes('meta'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt') || parts.includes('option'),
  };
}

/** Modifiers in a fixed order, then the key: `shift+mod+m` and `mod+shift+m` both become `mod+shift+m` */
export function canonicalKey(p: ParsedKey): string {
  const parts: string[] = [];
  if (p.mod) parts.push('mod');
  if (p.shift) parts.push('shift');
  if (p.alt) parts.push('alt');
  parts.push(p.key);
  return parts.join('+');
}

export const normalizeToken = (token: string): string => canonicalKey(parseKey(token));

/**
 * The canonical token for a key press, or null for a bare modifier. Shift is dropped for a symbol key
 * (`?` is Shift+/ on most layouts, and is authored as `'?'`), kept for letters (`shift+g`).
 */
export function eventToToken(e: KeyboardEvent): string | null {
  if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift') return null;
  const key = e.key.toLowerCase();
  const isSymbol = key.length === 1 && key.toUpperCase() === key.toLowerCase();
  return canonicalKey({ key, mod: isMac() ? e.metaKey : e.ctrlKey, shift: e.shiftKey && !isSymbol, alt: e.altKey });
}

/** `['g', 'c']` → `g c`; `['mod+k']` → `⌘K` (macOS) or `Ctrl+K` */
export function formatShortcut(keys: string[]): string {
  return keys
    .map((token) => {
      const p = parseKey(token);
      return `${p.mod ? (isMac() ? '⌘' : 'Ctrl+') : ''}${p.shift ? (isMac() ? '⇧' : 'Shift+') : ''}${p.alt ? (isMac() ? '⌥' : 'Alt+') : ''}${p.key.toUpperCase()}`;
    })
    .join(' ');
}

/** What the chord machine does with the keys pressed so far */
export type ChordMatch<T> = { kind: 'run'; command: T } | { kind: 'wait' } | { kind: 'none' };

/**
 * Match `pressed` (canonical tokens) against the commands' key sequences: run the one that ends exactly
 * here, wait when a longer sequence still starts this way, else nothing.
 */
export function matchChord<T extends { keys: string[] }>(pressed: string[], commands: T[]): ChordMatch<T> {
  const starts = commands.filter((c) => c.keys.length >= pressed.length && pressed.every((t, i) => c.keys[i] === t));
  const exact = starts.find((c) => c.keys.length === pressed.length);
  if (exact && starts.length === 1) return { kind: 'run', command: exact };
  if (starts.length > 0) return exact ? { kind: 'run', command: exact } : { kind: 'wait' };
  return { kind: 'none' };
}
