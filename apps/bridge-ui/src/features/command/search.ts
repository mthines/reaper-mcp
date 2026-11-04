import type { Command } from './types.js';

/** A command as the palette lists it: `trail` names the menus it sits under ("Timeline"), for a sub item found by search */
export interface Entry {
  command: Command;
  trail?: string;
  /** The command, or the menu it sits in, belongs to the current page */
  contextual?: boolean;
}

const plain = (label: string) => label.replace(/…$/, '');

/** The commands, then (for a search) every sub item under its menu, with the menu named in `trail` */
export function entriesOf(commands: Command[], deep: boolean, trail?: string, inherited = false): Entry[] {
  return commands.flatMap((command) => {
    const contextual = inherited || command.contextual === true;
    return [
      { command, trail, contextual },
      ...(deep && command.children ? entriesOf(command.children, true, trail ? `${trail} › ${plain(command.label)}` : plain(command.label), contextual) : []),
    ];
  });
}

/** Every word of the query must appear in the label, menu, group or description; label hits rank first, then this page's commands */
export function searchEntries(entries: Entry[], query: string): Entry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  const scored = entries
    .map((e, i) => ({ e, i, label: e.command.label.toLowerCase(), h: `${e.trail ?? ''} ${e.command.label} ${e.command.group ?? ''} ${e.command.description ?? ''}`.toLowerCase() }))
    .filter((x) => words.every((w) => x.h.includes(w)));
  const rank = (x: (typeof scored)[number]) => (words.every((w) => x.label.startsWith(w)) ? 0 : words.every((w) => x.label.includes(w)) ? 1 : 2);
  return scored.sort((a, b) => rank(a) - rank(b) || Number(b.e.contextual ?? false) - Number(a.e.contextual ?? false) || a.i - b.i).map((x) => x.e);
}

/** Entries under their group's heading, groups in the order they first appear; a search keeps the ranking in one list */
export function groupEntries(entries: Entry[], query: string): Array<{ label: string; entries: Entry[] }> {
  if (query.trim()) return entries.length ? [{ label: 'Results', entries }] : [];
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const label = e.command.group ?? 'Commands';
    groups.set(label, [...(groups.get(label) ?? []), e]);
  }
  // The page's own groups first, the rest in the order they registered
  const isContextual = (list: Entry[]) => list.some((e) => e.contextual);
  return [...groups]
    .map(([label, list]) => ({ label, entries: list }))
    .sort((a, b) => Number(isContextual(b.entries)) - Number(isContextual(a.entries)));
}
