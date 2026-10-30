import type { SpectrumBand, SpectrumSummary, TrackSpectrum } from '@reaper-mcp/protocol';

// Nominal 1/3-octave centres (IEC 61260), 25 Hz to 16 kHz
const CENTRES = [
  25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000,
];
const HALF_BAND = 2 ** (1 / 6);

// BS.1770 K-weighting gain (dB) at each centre, from the standard's 48 kHz
// filter (pre-filter shelf + RLB high-pass). Adding it to a band's raw level
// weighs the band the way LUFS does. Mirrored in knowledge/reference/perceived-loudness.md.
const K_WEIGHT_DB = [
  -10.4, -7.8, -5.6, -3.9, -2.7, -1.7, -1.1, -0.7, -0.4, -0.3, -0.2, -0.1, 0, 0, 0.1, 0.3,
  0.7, 1.3, 2.3, 3.1, 3.6, 3.8, 4, 4, 4, 4, 4, 4, 4,
];

// The analyzer floors every bin at -120 dB. Floor bins are left out of a band's
// sum: a few hundred of them would otherwise add up to ~-95 dB in silent high bands.
const FLOOR_DB = -120;

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Power-sums FFT bins into 1/3-octave bands. A band narrower than one bin
 * (low bands at small FFT sizes) has no bins and is left out. `kDb` is the
 * band K-weighted; balance decisions use it, never the raw `db`.
 */
export function toThirdOctaveBands(bins: number[], frequencyResolution: number): SpectrumBand[] {
  const bands: SpectrumBand[] = [];
  CENTRES.forEach((hz, c) => {
    const lo = Math.ceil(hz / HALF_BAND / frequencyResolution);
    const hi = Math.min(Math.ceil((hz * HALF_BAND) / frequencyResolution), bins.length);
    if (hi <= lo) return;
    let power = 0;
    for (let i = lo; i < hi; i++) if (bins[i] > FLOOR_DB) power += 10 ** (bins[i] / 10);
    const db = power > 0 ? Math.max(10 * Math.log10(power), FLOOR_DB) : FLOOR_DB;
    bands.push({
      hz,
      db: round1(db),
      kDb: db === FLOOR_DB ? FLOOR_DB : round1(db + K_WEIGHT_DB[c]),
    });
  });
  return bands;
}

export function summarizeSpectrum(data: TrackSpectrum, includeBins = false): SpectrumSummary {
  const { trackIndex, fftSize, sampleRate, frequencyResolution, peakDb, rmsDb, bins } = data;
  return {
    trackIndex, fftSize, sampleRate, frequencyResolution, peakDb, rmsDb,
    bands: toThirdOctaveBands(bins, frequencyResolution),
    ...(includeBins ? { bins } : {}),
  };
}
