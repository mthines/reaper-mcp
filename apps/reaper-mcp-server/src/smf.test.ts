import { describe, it, expect } from 'vitest';
import { parseSmf } from './smf.js';
import { smf, meta, name } from './__fixtures__/smf-builder.js';

describe('parseSmf', () => {
  it('reads notes in quarter notes, track names, tempo and time signature, dropping the conductor track', () => {
    const file = parseSmf(smf([
      [[0, ...meta(0x51, [0x07, 0xa1, 0x20])], [0, ...meta(0x58, [3, 2, 24, 8])]], // 120 BPM, 3/4
      [[0, ...name('Piano')], [0, 0x90, 60, 100], [480, 0x80, 60, 0], [0, 0x90, 64, 90], [240, 0x80, 64, 0]],
    ]));
    expect(file.tempo).toBe(120);
    expect(file.timeSignature).toEqual([3, 4]);
    expect(file.tracks).toHaveLength(1);
    expect(file.tracks[0].name).toBe('Piano');
    expect(file.tracks[0].notes).toEqual([
      { start: 0, length: 1, channel: 0, pitch: 60, velocity: 100 },
      { start: 1, length: 0.5, channel: 0, pitch: 64, velocity: 90 },
    ]);
    expect(file.lengthQN).toBe(1.5);
  });

  it('treats note-on velocity 0 as note-off and follows running status', () => {
    const file = parseSmf(smf([[[0, 0x91, 48, 80], [0, 50, 70], [960, 48, 0], [0, 50, 0], [0, 0xb1, 64, 127]]], { format: 0, ppq: 960 }));
    expect(file.tracks[0].notes.map((n) => [n.pitch, n.start, n.length, n.channel])).toEqual([[48, 0, 1, 1], [50, 0, 1, 1]]);
    expect(file.tracks[0].cc).toEqual([{ time: 1, channel: 1, cc: 64, value: 127 }]);
  });

  it('pairs overlapping notes of one pitch first-in first-out and closes notes left hanging', () => {
    const file = parseSmf(smf([[[0, 0x90, 60, 100], [240, 0x90, 60, 50], [240, 0x80, 60, 0], [480, 0x90, 62, 90]]]));
    const notes = file.tracks[0].notes.map((n) => [n.pitch, n.start, n.length, n.velocity]);
    expect(notes).toContainEqual([60, 0, 1, 100]);
    expect(notes.find((n) => n[0] === 62)).toBeTruthy();
    expect(notes.filter((n) => n[0] === 60)).toHaveLength(2);
  });

  it('skips sysex, program change and pitch bend without losing its place', () => {
    const file = parseSmf(smf([[[0, 0xf0, 3, 0x7e, 0x09, 0xf7], [0, 0xc0, 5], [0, 0xe0, 0, 64], [0, 0x90, 67, 100], [480, 0x80, 67, 0]]]));
    expect(file.tracks[0].notes).toEqual([{ start: 0, length: 1, channel: 0, pitch: 67, velocity: 100 }]);
  });

  it('refuses a file that is not MIDI, an SMPTE division and format 2, saying why', () => {
    expect(() => parseSmf(new TextEncoder().encode('RIFF....WAVEfmt '))).toThrow(/not a MIDI file/);
    const smpte = smf([[[0, 0x90, 60, 100]]]);
    smpte[12] = 0xe7;
    expect(() => parseSmf(smpte)).toThrow(/SMPTE/);
    expect(() => parseSmf(smf([[[0, 0x90, 60, 100]]], { format: 2 }))).toThrow(/format 2/);
  });

  it('reads UTF-8 track names, and Latin-1 ones from older files, without NUL padding', () => {
    const utf8 = [...new TextEncoder().encode('Café')];
    const file = parseSmf(smf([
      [[0, 0xff, 0x03, utf8.length + 1, ...utf8, 0], [0, 0x90, 60, 100], [480, 0x80, 60, 0]],
      [[0, 0xff, 0x03, 4, 0x43, 0x61, 0x66, 0xe9], [0, 0x90, 62, 100], [480, 0x80, 62, 0]],
    ]));
    expect(file.tracks.map((t) => t.name)).toEqual(['Café', 'Café']);
  });

  it('refuses a truncated track', () => {
    const file = smf([[[0, 0x90, 60, 100], [480, 0x80, 60, 0]]]);
    expect(() => parseSmf(file.subarray(0, file.length - 6))).toThrow(/unexpected end/);
  });
});
