import { describe, it, expect } from 'vitest';
import { ACCENT_BG, MIN_ACCENT_CONTRAST, NAMED_ACCENTS, accentForHue, autoHues, contrastRatio, parseAccent, resolveAccent, slugAccent } from './accent.js';

describe('plugin accents', () => {
  it('stays readable on the dark background at every hue a plugin can get', () => {
    for (let h = 0; h < 360; h += 5) expect(contrastRatio(accentForHue(h), ACCENT_BG)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    for (const hex of Object.values(NAMED_ACCENTS)) expect(contrastRatio(hex, ACCENT_BG)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
  });

  it('never gives an auto accent the meter colours (green, amber, red)', () => {
    for (const h of [150, 75, 22]) expect(autoHues()).not.toContain(h);
  });

  it('gives the same slug the same colour, and different slugs different colours', () => {
    expect(slugAccent('mutate-verb')).toBe(slugAccent('mutate-verb'));
    const many = new Set(['a', 'b', 'tape-sat', 'mutate-verb', 'width-bass-mono', 'crush'].map(slugAccent));
    expect(many.size).toBeGreaterThan(4);
  });

  it('reads names and hex, refuses anything else', () => {
    expect(parseAccent('Orange')).toEqual({ token: 'orange', kind: 'named' });
    expect(parseAccent('#ABCDEF')).toEqual({ token: '#abcdef', kind: 'custom' });
    expect(parseAccent('auto')).toEqual({ kind: 'auto' });
    expect(parseAccent('#abc')).toHaveProperty('error');
    expect(parseAccent('mauve')).toHaveProperty('error');
    expect(resolveAccent('x', 'blue')).toEqual({ hex: '#7cc4ff', kind: 'named', token: 'blue' });
  });
});
