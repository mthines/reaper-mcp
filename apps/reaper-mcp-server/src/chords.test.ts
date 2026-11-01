/**
 * Chords from pitch-class profiles (chords.ts): what detect_chords reports for a bar or
 * beat of notes, how equal neighbours merge, and what a bass line gets from it.
 */
import { describe, it, expect } from 'vitest';
import { matchChord, chordSpans, progression, romanNumeral, parseHarte, modelPicks, mergeSpans, chordProfile, type Segment } from './chords.js';
import { estimateKey } from './key.js';

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

describe('the chord model\'s labels', () => {
  it('reads Harte labels: root, quality and the bass as an interval', () => {
    expect(parseHarte('A:min7')).toEqual({ root: 9, quality: 'm7' });
    expect(parseHarte('Bb:maj')).toEqual({ root: 10, quality: 'maj' });
    expect(parseHarte('C:maj/3')).toEqual({ root: 0, quality: 'maj', bassPc: 4 });
    expect(parseHarte('D:min7/b7')).toEqual({ root: 2, quality: 'm7', bassPc: 0 });
    expect(parseHarte('F#:hdim7')).toEqual({ root: 6, quality: 'm7b5' });
    expect(parseHarte('E')).toEqual({ root: 4, quality: 'maj' });
    expect(parseHarte('G:7(b9)')).toEqual({ root: 7, quality: '7' });
    expect(parseHarte('A:(1,b3,5)')).toEqual({ root: 9, quality: 'min' });
    expect(parseHarte('Cb:minblues')).toEqual({ root: 11, quality: 'min' });
    expect(parseHarte('N')).toBeNull();
    expect(parseHarte('X')).toBeNull();
  });

  it('puts the chord covering most of each bar on it, and no chord where silence wins', () => {
    const bars = [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }];
    const picks = modelPicks(bars, [
      { start: 0, end: 1.6, label: 'C:maj' }, { start: 1.6, end: 2.5, label: 'G:maj/3' },
      { start: 2.5, end: 4.2, label: 'A:min' }, { start: 4.2, end: 6, label: 'N' },
    ]);
    expect(picks[0]).toEqual({ root: 0, quality: 'maj', score: 0.8 });
    expect(picks[1]).toEqual({ root: 9, quality: 'min', score: 0.75 });
    expect(picks[2]).toMatchObject({ score: 0.9 });
    expect(picks[2].root).toBeUndefined();
  });

  it('merges the model\'s chords into spans with slash names, numerals and the bass note to play', () => {
    const segs = [0, 1, 2].map((i) => ({ start: i * 2, end: i * 2 + 2, bar: i + 1, beat: 1 }));
    const spans = mergeSpans(segs, [
      { root: 7, quality: '7', bassPc: 11, score: 1 }, { root: 7, quality: '7', bassPc: 11, score: 0.8 }, { root: 0, quality: 'maj9', score: 1 },
    ], C_MAJOR);
    expect(spans.map((s) => s.chord)).toEqual(['G7/B', 'Cmaj9']);
    expect(spans[0]).toMatchObject({ length: 2, end: 4, roman: 'V7', bass: 'B', bassMidi: 35, score: 0.9 });
    expect(spans[1]).toMatchObject({ roman: 'Imaj9', bassMidi: 36 });
  });

  it('finds the key from the chords the model heard', () => {
    const am = chordProfile([
      { start: 0, end: 4, label: 'A:min' }, { start: 4, end: 6, label: 'D:min' }, { start: 6, end: 8, label: 'E:7' }, { start: 8, end: 12, label: 'A:min' },
    ]);
    expect(estimateKey(am)?.key).toBe('A minor');
    expect(chordProfile([{ start: 0, end: 4, label: 'N' }]).every((x) => x === 0)).toBe(true);
  });
});
