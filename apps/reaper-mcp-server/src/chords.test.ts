/**
 * Chords from pitch-class profiles (chords.ts): what detect_chords reports for a bar or
 * beat of notes, how equal neighbours merge, and what a bass line gets from it.
 */
import { describe, it, expect } from 'vitest';
import { matchChord, chordSpans, progression, romanNumeral, type Segment } from './chords.js';

/** A profile with weight on the given pitch classes (C = 0) */
const pcs = (...classes: number[]) => {
  const p = new Array(12).fill(0);
  for (const c of classes) p[c] += 1;
  return p;
};
const A_MINOR = { tonic: 'A', mode: 'minor' as const };
const C_MAJOR = { tonic: 'C', mode: 'major' as const };
const bars = (...profiles: number[][]): Segment[] => profiles.map((profile, i) => ({ start: i * 2, end: i * 2 + 2, bar: i + 1, beat: 1, profile }));

describe('matchChord', () => {
  it('names triads, sevenths and the rest by root and quality', () => {
    expect(matchChord(pcs(0, 4, 7))).toMatchObject({ chord: 'C', root: 'C', quality: 'maj' });
    expect(matchChord(pcs(9, 0, 4))).toMatchObject({ chord: 'Am', quality: 'min' });
    expect(matchChord(pcs(7, 11, 2, 5))).toMatchObject({ chord: 'G7', quality: '7' });
    expect(matchChord(pcs(2, 5, 9, 0))).toMatchObject({ chord: 'Dm7' });
    expect(matchChord(pcs(11, 2, 5))).toMatchObject({ chord: 'Bdim' });
    expect(matchChord(pcs(2, 7, 9))).toMatchObject({ chord: 'Dsus4' });
  });

  it('keeps a triad a triad when a passing note is quiet', () => {
    const p = pcs(0, 4, 7);
    p[2] = 0.2;
    expect(matchChord(p).chord).toBe('C');
  });

  it('calls silence and a chromatic smear no chord', () => {
    expect(matchChord(new Array(12).fill(0)).chord).toBe('N');
    expect(matchChord(new Array(12).fill(1)).chord).toBe('N');
  });
});

describe('romanNumeral', () => {
  it('numbers chords in major and minor keys, marking borrowed roots', () => {
    expect(romanNumeral('G', '7', C_MAJOR)).toBe('V7');
    expect(romanNumeral('A', 'min', C_MAJOR)).toBe('vi');
    expect(romanNumeral('B', 'dim', C_MAJOR)).toBe('vii°');
    expect(romanNumeral('Bb', 'maj', C_MAJOR)).toBe('♭VII');
    expect(romanNumeral('F', 'maj', A_MINOR)).toBe('VI');
    expect(romanNumeral('E', 'maj', A_MINOR)).toBe('V');
    expect(romanNumeral('D', 'min', A_MINOR)).toBe('iv');
  });
});

describe('chordSpans', () => {
  it('reads a progression bar by bar, merging a chord held over two bars', () => {
    const spans = chordSpans(bars(pcs(9, 0, 4), pcs(9, 0, 4), pcs(5, 9, 0), pcs(0, 4, 7), pcs(7, 11, 2)), A_MINOR);
    expect(spans.map((s) => [s.chord, s.roman, s.bar, s.length])).toEqual([
      ['Am', 'i', 1, 2], ['F', 'VI', 3, 1], ['C', 'III', 4, 1], ['G', 'VII', 5, 1],
    ]);
    expect(spans[0]).toMatchObject({ start: 0, end: 4 });
    expect(progression(spans)).toBe('Am F C G');
  });

  it('gives each chord a bass note between E1 and D#2 for a bass line', () => {
    const [am, e, g] = chordSpans(bars(pcs(9, 0, 4), pcs(4, 8, 11), pcs(7, 11, 2)), A_MINOR);
    expect(am.bassMidi).toBe(33); // A1
    expect(e.bassMidi).toBe(28); // E1
    expect(g.bassMidi).toBe(31); // G1
  });

  it('names a slash chord from the lowest held note and plays that note in the bass', () => {
    const [span] = chordSpans([{ start: 0, end: 2, bar: 1, beat: 1, profile: pcs(0, 4, 7), bass: 52 }], C_MAJOR);
    expect(span).toMatchObject({ chord: 'C/E', root: 'C', bass: 'E', bassMidi: 28 });
  });

  it('holds a chord through a beat that only leans toward another', () => {
    // Bar 2 adds an A: on its own it reads as Am7, but C still fits nearly as well, so the C goes on
    const lean = pcs(0, 4, 7);
    lean[9] = 0.6;
    expect(matchChord(lean, C_MAJOR).chord).toBe('Am7');
    const spans = chordSpans(bars(pcs(0, 4, 7), lean), C_MAJOR);
    expect(spans.map((s) => s.chord)).toEqual(['C']);
  });

  it('marks silent bars as no chord and leaves them out of the progression', () => {
    const spans = chordSpans(bars(pcs(0, 4, 7), new Array(12).fill(0), pcs(5, 9, 0)), C_MAJOR);
    expect(spans.map((s) => s.chord)).toEqual(['C', 'N', 'F']);
    expect(spans[1].bassMidi).toBeUndefined();
    expect(progression(spans)).toBe('C F');
  });
});
