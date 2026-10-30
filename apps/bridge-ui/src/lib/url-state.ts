import { useCallback, useSyncExternalStore } from 'react';

/**
 * useState-compatible state kept in a URL search param, so browser back/forward step through it and a
 * link reopens it. Ported from LoreKit web's `useUrlState` (same helpers and defaults-stay-out-of-the-URL
 * rule), on the History API instead of the Next.js router: the write lands in a microtask, before the next
 * paint, and every hook is notified at once, so there is no navigation round trip and no optimistic layer
 * to bridge it.
 */

/** `mode` overrides the hook's navigationMode for this one change (e.g. replace while stepping through rows) */
export type UrlStateDispatch<S> = (value: S | ((prev: S) => S), mode?: 'push' | 'replace') => void;

export interface UseUrlStateOptions<T> {
  /** 'push' (default) adds a history entry so Back undoes the change; 'replace' doesn't */
  navigationMode?: 'push' | 'replace';
  /** Reject values that don't parse to something valid (an old or hand-edited link) */
  validate?: (value: unknown) => value is T;
}

// Validators for common param shapes
export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
export const isString = (v: unknown): v is string => typeof v === 'string';
export const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
export const isNumberOrNull = (v: unknown): v is number | null => v === null || typeof v === 'number';

/** JSON-serialise a value to a URL param string. */
export function serialise<T>(value: T): string {
  return JSON.stringify(value);
}

/** JSON-deserialise a URL param string, returning `fallback` on null or parse error. */
export function deserialise<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** The URL after setting one param; a value equal to the default removes it, to keep URLs clean. */
export function buildUrl<T>(pathname: string, search: string, key: string, next: T, defaultValue: T, hash = ''): string {
  const params = new URLSearchParams(search);
  if (serialise(next) === serialise(defaultValue)) params.delete(key);
  else params.set(key, serialise(next));
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ''}${hash}`;
}

// One store for every hook: pushState fires no event, so writes notify subscribers themselves
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// Changes made in the same tick (one click setting view, filter and search) become one history entry,
// a push if any of them asked for one
let pending: { search: string; push: boolean } | null = null;
function write(key: string, next: unknown, defaultValue: unknown, mode: 'push' | 'replace') {
  const base = pending?.search ?? location.search;
  const url = new URL(buildUrl(location.pathname, base, key, next, defaultValue), location.href);
  if (!pending) queueMicrotask(flush);
  pending = { search: url.search, push: (pending?.push ?? false) || mode === 'push' };
}
function flush() {
  if (!pending) return;
  const url = `${location.pathname}${pending.search}${location.hash}`;
  if (pending.push) history.pushState(history.state, '', url);
  else history.replaceState(history.state, '', url);
  pending = null;
  notify();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('popstate', notify);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('popstate', notify);
  };
}
const getSearch = () => location.search;

/**
 * `defaultValue` is what the URL means without the param; keep it stable for the page's lifetime
 * (history entries written without the param are read back as it).
 */
export function useUrlState<T>(key: string, defaultValue: T, options: UseUrlStateOptions<T> = {}): [T, UrlStateDispatch<T>] {
  const { navigationMode = 'push', validate } = options;
  const search = useSyncExternalStore(subscribe, getSearch);
  const parsed = deserialise<unknown>(new URLSearchParams(search).get(key), defaultValue);
  const value = !validate || validate(parsed) ? (parsed as T) : defaultValue;

  const setState = useCallback<UrlStateDispatch<T>>(
    (valueOrUpdater, mode = navigationMode) => {
      const raw = deserialise<unknown>(new URLSearchParams(pending?.search ?? location.search).get(key), defaultValue);
      const prev = !validate || validate(raw) ? (raw as T) : defaultValue;
      const next = typeof valueOrUpdater === 'function' ? (valueOrUpdater as (p: T) => T)(prev) : valueOrUpdater;
      if (serialise(next) === serialise(prev)) return;
      write(key, next, defaultValue, mode);
    },
    // defaultValue is stable by contract; compared by value so an inline literal is fine too
    [key, serialise(defaultValue), navigationMode, validate],
  );

  return [value, setState];
}
