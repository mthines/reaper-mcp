import { useCallback, useSyncExternalStore } from 'react';
import { load, save } from './storage.js';

/**
 * Where views that can zoom look: around the change (the default) or at the whole project. One preference for every
 * such view, kept per viewer in localStorage, so picking "whole" once holds for the next call and the next visit.
 */
export type Zoom = 'change' | 'whole';

const KEY = 'mcp-bridge-zoom';
const listeners = new Set<() => void>();
const read = (): Zoom => (load(KEY) === 'whole' ? 'whole' : 'change');
let current: Zoom | null = null;
const get = () => (current ??= read());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useZoom(): [Zoom, (z: Zoom) => void] {
  const zoom = useSyncExternalStore(subscribe, get);
  const set = useCallback((z: Zoom) => {
    current = z;
    save(KEY, z);
    listeners.forEach((l) => l());
  }, []);
  return [zoom, set];
}
