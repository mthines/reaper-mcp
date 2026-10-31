import { type CommandEntry, parseParams } from './commands.js';

/**
 * One search term: plain text matches the command name, error or params anywhere; `key:value` matches a
 * param exactly (`trackIndex:6` is not track 16). A value with spaces is quoted: `fxName:"VST3: Pro-Q 3"`.
 */
export interface QueryTerm {
  key?: string;
  value: string;
}

/** Whitespace-separated terms, all of which must match */
export function parseQuery(query: string): QueryTerm[] {
  const terms: QueryTerm[] = [];
  for (const m of query.matchAll(/(\w+):"([^"]*)"?|(\w+):(\S+)|"([^"]*)"?|(\S+)/g)) {
    if (m[1] !== undefined) terms.push({ key: m[1], value: m[2].toLowerCase() });
    else if (m[3] !== undefined) terms.push({ key: m[3], value: m[4].toLowerCase() });
    else {
      const v = (m[5] ?? m[6]).toLowerCase();
      if (v) terms.push({ value: v });
    }
  }
  return terms;
}

export function matchesQuery(e: CommandEntry, terms: QueryTerm[]): boolean {
  if (terms.length === 0) return true;
  let params: Record<string, unknown> | null | undefined;
  return terms.every((t) => {
    if (t.key === undefined) return e.c.toLowerCase().includes(t.value) || !!e.e?.toLowerCase().includes(t.value) || !!e.p?.toLowerCase().includes(t.value);
    if (params === undefined) {
      const p = parseParams(e.p);
      params = p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
    }
    const v = params?.[t.key];
    return v !== undefined && v !== null && typeof v !== 'object' && String(v).toLowerCase() === t.value;
  });
}

/** The term that filters to a param, quoted when the value has spaces */
export function paramTerm(key: string, value: unknown): string {
  const v = String(value);
  return /[\s"]/.test(v) ? `${key}:"${v.replace(/"/g, '')}"` : `${key}:${v}`;
}

/**
 * What a text selection in the formatted params filters by: inside one `"key": value` line, that param
 * (wherever on the line the selection is); otherwise the selected words.
 */
export function termFromSelection(text: string, start: number, end: number): string | null {
  const [from, to] = start <= end ? [start, end] : [end, start];
  const selected = text.slice(from, to).trim();
  if (!selected) return null;
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const nl = text.indexOf('\n', from);
  const lineEnd = nl === -1 ? text.length : nl;
  if (to <= lineEnd) {
    const kv = /^\s*"(\w+)":\s*(.+?),?\s*$/.exec(text.slice(lineStart, lineEnd));
    if (kv && !/^[[{]/.test(kv[2])) {
      try {
        return paramTerm(kv[1], JSON.parse(kv[2]));
      } catch {
        // not a plain JSON value: fall back to the text
      }
    }
  }
  // Any other text: its words, each a plain term
  return selected.replace(/["{}]/g, ' ').split(/\s+/).filter(Boolean).join(' ') || null;
}
