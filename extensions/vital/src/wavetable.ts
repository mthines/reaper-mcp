/**
 * Wavetables for Vital: a "Wave Source" component whose keyframes each hold one 2048-sample frame as
 * base64 little-endian float32 (the shape Vital's own factory wavetables use), at positions 0-255.
 */

export const FRAME_SIZE = 2048;
export const MAX_FRAMES = 256;
const MAX_HARMONICS = 512;

export interface WaveKeyframe {
  position: number;
  wave_data: string;
}

export interface VitalWavetable {
  author: string;
  full_normalize: boolean;
  groups: { components: Record<string, unknown>[] }[];
  name: string;
  remove_all_dc: boolean;
  version: string;
}

export type ShapeName = 'sine' | 'saw' | 'square' | 'triangle';

/** Harmonic amplitudes (1st, 2nd, …) of a classic shape, band-limited to `count` harmonics. */
export function shapeHarmonics(shape: ShapeName, count = 64): number[] {
  const n = Math.min(Math.max(1, Math.floor(count)), MAX_HARMONICS);
  return Array.from({ length: n }, (_, i) => {
    const k = i + 1;
    switch (shape) {
      case 'sine':
        return k === 1 ? 1 : 0;
      case 'saw':
        return 1 / k;
      case 'square':
        return k % 2 === 1 ? 1 / k : 0;
      case 'triangle':
        // Odd harmonics at 1/k², alternating sign (a sine-phase triangle)
        return k % 2 === 1 ? (((k - 1) / 2) % 2 === 0 ? 1 : -1) / (k * k) : 0;
    }
  });
}

/**
 * One frame by additive synthesis: `sum(amps[k] * sin(2π (k+1) t + phases[k]))`, scaled so the peak is 1.
 * Refused when every amplitude is zero (it would be silence) or a value is not a finite number.
 */
export function frameFromHarmonics(amps: number[], phases: number[] = []): Float32Array {
  if (amps.length === 0 || amps.length > MAX_HARMONICS) throw new Error(`harmonics must hold 1 to ${MAX_HARMONICS} amplitudes`);
  if (![...amps, ...phases].every(Number.isFinite)) throw new Error('harmonics and phases must be finite numbers');
  const out = new Float64Array(FRAME_SIZE);
  amps.forEach((a, i) => {
    if (a === 0) return;
    const phase = phases[i] ?? 0;
    const step = (2 * Math.PI * (i + 1)) / FRAME_SIZE;
    for (let n = 0; n < FRAME_SIZE; n++) out[n] += a * Math.sin(step * n + phase);
  });
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak < 1e-9) throw new Error('the harmonics add up to silence; give at least one non-zero amplitude');
  return Float32Array.from(out, (v) => v / peak);
}

export function encodeFrame(frame: Float32Array): string {
  return Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength).toString('base64');
}

export function decodeFrame(b64: string): Float32Array {
  const raw = Buffer.from(b64, 'base64');
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

/** Where `count` frames sit on Vital's 0-255 position axis: evenly, the first at 0 and the last at 255. */
export function framePositions(count: number): number[] {
  if (count < 1 || count > MAX_FRAMES) throw new Error(`a wavetable holds 1 to ${MAX_FRAMES} frames`);
  return count === 1 ? [0] : Array.from({ length: count }, (_, i) => Math.round((i * (MAX_FRAMES - 1)) / (count - 1)));
}

export function buildWavetable(opts: { name: string; frames: Float32Array[]; author?: string }): VitalWavetable {
  const positions = framePositions(opts.frames.length);
  for (const f of opts.frames) {
    if (f.length !== FRAME_SIZE) throw new Error(`every frame must have ${FRAME_SIZE} samples`);
  }
  return {
    author: opts.author ?? '',
    full_normalize: true,
    groups: [
      {
        components: [
          {
            interpolation: 0,
            interpolation_style: 0,
            type: 'Wave Source',
            keyframes: opts.frames.map((f, i) => ({ position: positions[i], wave_data: encodeFrame(f) })),
          },
        ],
      },
    ],
    name: opts.name,
    remove_all_dc: true,
    version: '1.0.8',
  };
}
