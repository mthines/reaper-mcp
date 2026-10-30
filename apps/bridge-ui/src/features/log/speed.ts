import { VERY_SLOW_MS, type Speed } from '../../lib/status.js';

export const TOOL_TONE: Record<Speed, string> = { fast: '', slow: 'tone-warn', 'very-slow': 'tone-bad', long: '' };
export const SPEED_LABEL: Record<Speed, string> = { fast: 'Fast', slow: 'Slow', 'very-slow': 'Very slow', long: 'Long-running (expected)' };

/** Log-scaled so 1 ms and 500 ms both read. */
export const latencyScale = (ms: number) => Math.min(1, Math.max(0.06, Math.log10(1 + ms) / Math.log10(1 + VERY_SLOW_MS)));
