import { describe, it, expect } from 'vitest';
import { toThirdOctaveBands } from './spectrum.js';

const RES = 44100 / 4096; // ~10.77 Hz per bin

function binsWithTone(hz: number, db: number): number[] {
  const bins = new Array(2048).fill(-120);
  bins[Math.round(hz / RES)] = db;
  return bins;
}

describe('toThirdOctaveBands', () => {
  it('puts a tone in the band whose centre is nearest', () => {
    const bands = toThirdOctaveBands(binsWithTone(1000, -20), RES);
    const loudest = bands.reduce((a, b) => (b.db > a.db ? b : a));
    expect(loudest).toMatchObject({ hz: 1000, db: -20 });
  });

  it('power-sums the bins in a band', () => {
    const bins = new Array(2048).fill(-120);
    const i = Math.round(1000 / RES);
    bins[i] = -20;
    bins[i + 1] = -20; // two equal bins = +3 dB
    const band = toThirdOctaveBands(bins, RES).find((b) => b.hz === 1000);
    expect(band?.db).toBeCloseTo(-17, 0);
  });

  it('reads a silent band as the -120 dB floor, not the sum of its floor bins', () => {
    const bands = toThirdOctaveBands(new Array(2048).fill(-120), RES);
    expect(bands.find((b) => b.hz === 16000)?.db).toBe(-120);
  });

  it('leaves out bands narrower than one bin', () => {
    const bands = toThirdOctaveBands(new Array(256).fill(-120), 44100 / 512); // 86 Hz bins
    expect(bands[0].hz).toBeGreaterThan(25);
    expect(bands.every((b) => Number.isFinite(b.db))).toBe(true);
  });

  it('K-weights each band the way LUFS does', () => {
    const bins = new Array(2048).fill(-120);
    bins[Math.round(100 / RES)] = -20;
    bins[Math.round(4000 / RES)] = -20;
    const bands = toThirdOctaveBands(bins, RES);
    expect(bands.find((b) => b.hz === 100)?.kDb).toBe(-21.1);
    expect(bands.find((b) => b.hz === 4000)?.kDb).toBe(-16);
    expect(bands.find((b) => b.hz === 16000)?.kDb).toBe(-120);
  });
});
