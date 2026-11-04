import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import { CommandPalette } from './CommandPalette.js';
import { ShortcutHelp } from './ShortcutHelp.js';
import { CHORD_TIMEOUT_MS, eventToToken, matchChord, normalizeToken } from './shortcut.js';
import type { Command } from './types.js';

interface Registry {
  register: (command: Command) => () => void;
}

interface Palette {
  open: boolean;
  setOpen: (open: boolean) => void;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
}

const RegistryContext = createContext<Registry | null>(null);
const PaletteContext = createContext<Palette | null>(null);

export const useCommandRegistry = () => useContext(RegistryContext);
/** The palette's open state; null outside a provider (stories, tests of one component) */
export const useCommandPalette = () => useContext(PaletteContext);

/** How long the fade-out runs before the dialog unmounts (matches CommandPalette.module.css) */
const LEAVE_MS = 120;

const isTyping = (el: Element | null) =>
  Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable));

/**
 * Holds every registered command, draws the palette (⌘K) and the shortcut sheet (?), and runs shortcuts:
 * single keys and chords (`g` then `c`) fire anywhere except while typing in a field; ⌘K always opens the palette.
 */
export function CommandProvider({ children }: { children: ReactNode }) {
  const [commands, setCommands] = useState<ReadonlyMap<string, Command>>(() => new Map());
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Closing plays a short fade; the dialog unmounts when it is done
  const [closing, setClosing] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout>>(undefined);

  const register = useCallback((command: Command) => {
    setCommands((prev) => new Map(prev).set(command.id, command));
    return () =>
      setCommands((prev) => {
        // A newer registration of the same id (a re-register) must survive the old one's cleanup
        if (prev.get(command.id) !== command) return prev;
        const next = new Map(prev);
        next.delete(command.id);
        return next;
      });
  }, []);
  // Stable: registering a command re-renders the provider (and the open palette), never every command's component
  const registry = useMemo<Registry>(() => ({ register }), [register]);
  const list = [...commands.values()];
  const show = useCallback((which: 'palette' | 'help') => {
    clearTimeout(leave.current);
    setClosing(false);
    setOpen(which === 'palette');
    setHelpOpen(which === 'help');
  }, []);
  const hide = useCallback(() => {
    clearTimeout(leave.current);
    setClosing(true);
    leave.current = setTimeout(() => {
      setOpen(false);
      setHelpOpen(false);
      setClosing(false);
    }, LEAVE_MS);
  }, []);
  const palette = useMemo<Palette>(
    () => ({
      open,
      setOpen: (on) => (on ? show('palette') : hide()),
      helpOpen,
      setHelpOpen: (on) => (on ? show('help') : hide()),
    }),
    [open, helpOpen, show, hide],
  );

  // The chord pressed so far; reset after CHORD_TIMEOUT_MS of silence
  const pressed = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onKey = useEffectEvent((ev: KeyboardEvent) => {
    const token = eventToToken(ev);
    if (token === null) return;
    if (token === 'mod+k') {
      ev.preventDefault();
      pressed.current = [];
      if (open && !closing) hide();
      else show('palette');
      return;
    }
    // Only the palette or the sheet's own keys while one is open; typing in a field is never a shortcut
    if (open || helpOpen || ev.defaultPrevented || isTyping(document.activeElement)) {
      if (helpOpen && token === 'escape') hide();
      return;
    }
    const bound = [...commands.values()]
      .filter((c) => c.shortcut && c.onSelect)
      .map((c) => ({ command: c, keys: (c.shortcut ?? []).map(normalizeToken) }));
    // A key that doesn't continue the chord starts a new one
    let next = [...pressed.current, token];
    let match = matchChord(next, bound);
    if (match.kind === 'none' && pressed.current.length > 0) {
      next = [token];
      match = matchChord(next, bound);
    }
    clearTimeout(timer.current);
    if (match.kind === 'wait') {
      ev.preventDefault();
      pressed.current = next;
      timer.current = setTimeout(() => (pressed.current = []), CHORD_TIMEOUT_MS);
      return;
    }
    pressed.current = [];
    if (match.kind === 'run') {
      ev.preventDefault();
      match.command.command.onSelect?.();
    }
  });
  useEffect(() => {
    const listener = (ev: KeyboardEvent) => onKey(ev);
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
      clearTimeout(timer.current);
      clearTimeout(leave.current);
    };
  }, []);

  return (
    <RegistryContext.Provider value={registry}>
      <PaletteContext.Provider value={palette}>
        {children}
        {open && <CommandPalette commands={list} closing={closing} onClose={hide} />}
        {helpOpen && <ShortcutHelp commands={list} closing={closing} onClose={hide} />}
      </PaletteContext.Provider>
    </RegistryContext.Provider>
  );
}
