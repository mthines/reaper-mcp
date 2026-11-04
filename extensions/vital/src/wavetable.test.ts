import { describe, it, expect } from 'vitest';
import { FRAME_SIZE, buildWavetable, decodeFrame, encodeFrame, frameFromHarmonics, framePositions, shapeHarmonics } from './wavetable.js';

const peak = (f: Float32Array) => f.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const zeroCrossings = (f: Float32Array) => f.reduce((n, v, i) => n + (i > 0 && Math.sign(v) !== Math.sign(f[i - 1]) && f[i - 1] !== 0 ? 1 : 0), 0);

describe('wavetable frames', () => {
  it('a single harmonic is a sine with one cycle per frame, peaking at 1', () => {
    const f = frameFromHarmonics([1]);
    expect(f.length).toBe(FRAME_SIZE);
    expect(peak(f)).toBeCloseTo(1, 5);
    expect(f[FRAME_SIZE / 4]).toBeCloseTo(1, 4);
    expect(zeroCrossings(f)).toBe(1);
  });

  it('the Nth harmonic has N cycles per frame', () => {
    expect(zeroCrossings(frameFromHarmonics([0, 0, 0, 1]))).toBe(7);
  });

  it('classic shapes have their characteristic spectrum: a square has only odd harmonics, a saw falls off as 1/k', () => {
    const sq = shapeHarmonics('square', 8);
    expect(sq.filter((a, i) => (i + 1) % 2 === 0 && a !== 0)).toEqual([]);
    expect(shapeHarmonics('saw', 4)).toEqual([1, 1 / 2, 1 / 3, 1 / 4]);
    // a band-limited square is a plateau in each half: positive, then negative. The frame is scaled to its Gibbs
    // overshoot (~9%), so the plateau sits a little under 1.
    const f = frameFromHarmonics(shapeHarmonics('square', 64));
    expect(f[FRAME_SIZE / 4]).toBeGreaterThan(0.8);
    expect(f[FRAME_SIZE / 4]).toBeLessThan(1);
    expect(f[(FRAME_SIZE * 3) / 4]).toBeLessThan(-0.8);
  });

  it('phases move the waveform: a quarter-cycle phase turns a sine into a cosine', () => {
    const f = frameFromHarmonics([1], [Math.PI / 2]);
    expect(f[0]).toBeCloseTo(1, 4);
  });

  it('refuses silence, empty or oversized harmonic lists and non-numbers, saying why', () => {
    expect(() => frameFromHarmonics([0, 0])).toThrow(/silence/);
    expect(() => frameFromHarmonics([])).toThrow(/1 to 512/);
    expect(() => frameFromHarmonics(new Array(513).fill(1))).toThrow(/1 to 512/);
    expect(() => frameFromHarmonics([1, NaN])).toThrow(/finite/);
  });

  it('encodes to base64 float32 of 8192 bytes and decodes back exactly', () => {
    const f = frameFromHarmonics(shapeHarmonics('triangle', 16));
    const b64 = encodeFrame(f);
    expect(Buffer.from(b64, 'base64').length).toBe(FRAME_SIZE * 4);
    expect(Array.from(decodeFrame(b64))).toEqual(Array.from(f));
  });
});

describe('wavetable keyframes', () => {
  it('spreads frames evenly over 0-255, first at 0 and last at 255', () => {
    expect(framePositions(1)).toEqual([0]);
    expect(framePositions(2)).toEqual([0, 255]);
    expect(framePositions(3)).toEqual([0, 128, 255]);
    expect(framePositions(256)[255]).toBe(255);
  });

  it('refuses zero frames and more than 256', () => {
    expect(() => framePositions(0)).toThrow(/1 to 256/);
    expect(() => framePositions(257)).toThrow(/1 to 256/);
  });

  it('builds a wavetable in the shape Vital reads: one Wave Source with a keyframe per frame', () => {
    const frames = ['sine', 'saw'].map((s) => frameFromHarmonics(shapeHarmonics(s as 'sine' | 'saw')));
    const wt = buildWavetable({ name: 'Sine to Saw', frames, author: 'me' });
    expect(wt).toMatchObject({ name: 'Sine to Saw', author: 'me' });
    const comp = wt.groups[0].components[0] as { type: string; keyframes: { position: number; wave_data: string }[] };
    expect(comp.type).toBe('Wave Source');
    expect(comp.keyframes.map((k) => k.position)).toEqual([0, 255]);
    expect(Array.from(decodeFrame(comp.keyframes[1].wave_data))).toEqual(Array.from(frames[1]));
  });

  it('refuses a frame of the wrong length', () => {
    expect(() => buildWavetable({ name: 'x', frames: [new Float32Array(100)] })).toThrow(/2048 samples/);
  });
});
