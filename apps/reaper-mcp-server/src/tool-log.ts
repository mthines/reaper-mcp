import { sendCommand } from './bridge.js';

/**
 * Results of tools the server composes itself (sidecar analysis), logged on the bridge's status page like a bridge
 * command: the bridge records `_log_result` as an entry for `command`, with `r` drawn by the page's measurement views.
 * Best-effort and in the background, so a slow or missing bridge never delays the tool's answer.
 */
export function logToolResult(command: string, params: Record<string, unknown>, startedAt: number, r: Record<string, unknown> | null, error?: string): void {
  void sendCommand('_log_result' as Parameters<typeof sendCommand>[0], {
    command,
    ms: Date.now() - startedAt,
    ok: error ? 0 : 1,
    p: JSON.stringify(params).slice(0, 400),
    // Nested values travel as a JSON string: the bridge's fallback parser only reads flat params
    ...(r ? { r: JSON.stringify(r) } : {}),
    ...(error ? { e: error.slice(0, 300) } : {}),
  }, 2_000).catch(() => {
    // The page is a convenience; the tool already answered
  });
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const BANDS = ['sub', 'bass', 'lowMid', 'mid', 'upperMid', 'presence', 'brilliance'];
const MAX_SECTIONS = 48;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

/** analyze_track_offline / analyze_audio_file: the numbers the page draws, a few hundred bytes */
export function offlineSummary(name: string, result: Obj): Obj {
  const loud = obj(result['loudness']);
  const spec = obj(result['spectrum']);
  const ref = result['reference'] ? obj(result['reference']) : null;
  const sections = Array.isArray(loud['sections']) ? (loud['sections'] as Obj[]) : [];
  const resonances = Array.isArray(spec['resonances']) ? (spec['resonances'] as Obj[]) : [];
  const bandsOf = (b: unknown) => BANDS.map((k) => num(obj(b)[k]) ?? null);
  return {
    name,
    lufs: num(loud['integratedLufs']),
    lra: num(loud['loudnessRangeLu']),
    tp: num(loud['truePeakDbtp']),
    peak: num(loud['samplePeakDbfs']),
    crest: num(loud['crestFactorDb']),
    dur: num(loud['durationSeconds']),
    sections: sections.slice(0, MAX_SECTIONS).flatMap((s) => {
      const [a, b, l] = [num(s['start']), num(s['end']), num(s['lufs'])];
      return a !== undefined && b !== undefined && l !== undefined ? [[a, b, l]] : [];
    }),
    bands: bandsOf(spec['bandBalanceDb']),
    res: resonances.slice(0, 5).flatMap((h) => (num(h['hz']) !== undefined && num(h['excessDb']) !== undefined ? [[h['hz'], h['excessDb']]] : [])),
    sib: num(obj(spec['sibilance'])['spikeCount']),
    ...(ref ? { ref: { lufs: num(ref['referenceIntegratedLufs']), delta: num(ref['loudnessDeltaLu']), bands: bandsOf(ref['bandDeltaDb']) } } : {}),
  };
}

/** measure_track_alignment: who was measured against whom, the delay, polarity and the suggested fix */
export function alignmentSummary(data: Obj): Obj {
  return {
    ref: data['referenceName'],
    name: data['trackName'],
    delayMs: num(data['delayMs']),
    samples: num(data['delaySamples']),
    corr: num(data['correlation']),
    inv: data['polarityInverted'] === true ? 1 : 0,
    cur: num(data['currentPlayOffsetMs']),
    offset: num(data['suggestedPlayOffsetMs']),
    phase: num(data['suggestedPhase']),
    ...(data['warning'] ? { warn: 1 } : {}),
  };
}

/** analyze_track_aesthetics: the four scores and the level they were judged at */
export function aestheticsSummary(data: Obj): Obj {
  return {
    name: data['trackName'],
    pq: num(data['productionQuality']),
    pc: num(data['productionComplexity']),
    ce: num(data['contentEnjoyment']),
    cu: num(data['contentUsefulness']),
    lufs: num(data['normalizedToLufs']),
    dur: num(data['durationSeconds']),
  };
}
