import { useEffect, useRef } from 'react';
import { useCommandRegistry } from './CommandProvider.js';
import type { Command } from './types.js';

/**
 * Put a command in the palette (and bind its shortcut) while the calling component is mounted, or while
 * `enabled`. Call it at a stable hook position, never in a `.map()`: wrap each item in a component that calls it.
 * Without a `CommandProvider` (stories) it does nothing.
 */
export function useCommand(command: Command, enabled = true): void {
  const registry = useCommandRegistry();
  const latest = useRef(command);
  // Kept current after every commit, so the palette (read later) never sees a stale closure
  useEffect(() => {
    latest.current = command;
  });
  const register = registry?.register;
  // Re-register when what the palette shows or binds changes; `onSelect` is read through the ref at run time
  const shortcut = command.shortcut?.join(' ');
  const childIds = command.children?.map((c) => c.id).join(' ');
  useEffect(() => {
    if (!register || !enabled) return;
    return register(liveCommand(latest));
  }, [register, enabled, command.id, command.label, command.description, command.group, command.hint, shortcut, childIds]);
}

/**
 * The registry's copy of a command: identity fixed, everything else read from the latest render when the palette
 * looks, so a closure from an old render is never run. A plain function (not a hook): the React Compiler skips getters.
 */
function liveCommand(latest: { current: Command }): Command {
  const now = () => latest.current;
  return {
    id: latest.current.id,
    get label() { return now().label; },
    get description() { return now().description; },
    get icon() { return now().icon; },
    get group() { return now().group; },
    get contextual() { return now().contextual; },
    get shortcut() { return now().shortcut; },
    get hint() { return now().hint; },
    get children() { return now().children; },
    onSelect: () => now().onSelect?.(),
  };
}
