// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { eventToToken, formatShortcut, matchChord, normalizeToken } from './shortcut.js';

const press = (init: KeyboardEventInit) => eventToToken(new KeyboardEvent('keydown', init));
const keys = (...k: string[]) => ({ keys: k });

describe('shortcut keys', () => {
  it('reads one authored token the same however its modifiers are ordered', () => {
    expect(normalizeToken('shift+mod+M')).toBe('mod+shift+m');
  });

  it('turns a key press into the token a shortcut is authored with', () => {
    expect(press({ key: 'g' })).toBe('g');
    expect(press({ key: 'G', shiftKey: true })).toBe('shift+g');
    // ? is Shift+/ on most layouts, and is authored as '?'
    expect(press({ key: '?', shiftKey: true })).toBe('?');
    expect(press({ key: 'k', ctrlKey: true })).toBe('mod+k');
  });

  it('ignores a modifier pressed on its own', () => {
    expect(press({ key: 'Shift' })).toBeNull();
    expect(press({ key: 'Meta' })).toBeNull();
  });

  it('shows a chord as its keys in order', () => {
    expect(formatShortcut(['g', 'c'])).toBe('G C');
  });
});

describe('matching a chord', () => {
  const bound = [keys('g', 'c'), keys('g', 's'), keys('f'), keys('g')];

  it('runs a single key at once', () => {
    expect(matchChord(['f'], bound)).toEqual({ kind: 'run', command: keys('f') });
  });

  it('waits after g while a longer chord could still follow, then runs the one that completes', () => {
    expect(matchChord(['g'], [keys('g', 'c'), keys('g', 's')])).toEqual({ kind: 'wait' });
    expect(matchChord(['g', 's'], bound)).toEqual({ kind: 'run', command: keys('g', 's') });
  });

  it('does nothing for a key nothing is bound to', () => {
    expect(matchChord(['z'], bound)).toEqual({ kind: 'none' });
    expect(matchChord(['g', 'z'], bound)).toEqual({ kind: 'none' });
  });
});
