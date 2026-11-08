/** The waveform's dB scale: silence at the centre line, full scale at the edges */
export const WAVE_FLOOR = -48;

/** A sample (−1..1) as its height on the dB scale (−1..1), sign kept */
export const waveScale = (v: number) => {
  const a = Math.min(1, Math.abs(v));
  const h = a > 0 ? Math.max(0, (20 * Math.log10(a) - WAVE_FLOOR) / -WAVE_FLOOR) : 0;
  return v < 0 ? -h : h;
};

/** Distance from the top (0) to the centre (0.5) at which a level sits, for gradient stops and grid lines */
export const waveOffset = (db: number) => (1 - (db - WAVE_FLOOR) / -WAVE_FLOOR) / 2;

/** The outline of min/max slices across `width`, `height` tall, as an SVG path */
export function waveOutline(w: { hi: number[]; lo: number[] }, width: number, height: number): string {
  const y = (v: number) => ((1 - waveScale(v)) / 2) * height;
  const at = (vals: number[]) => vals.map((v, i) => `${((i / Math.max(1, vals.length - 1)) * width).toFixed(1)},${y(v).toFixed(1)}`);
  return `M${at(w.hi).join('L')}L${at(w.lo).reverse().join('L')}Z`;
}

/** The colour stops of a waveform: accent, amber from −6 dB, red at full scale, mirrored about the centre line */
export const WAVE_HEAT: Array<[number, string]> = [
  [0, 'bad'],
  [-1, 'warn'],
  [-6, 'warn'],
  [-18, 'accent'],
];
