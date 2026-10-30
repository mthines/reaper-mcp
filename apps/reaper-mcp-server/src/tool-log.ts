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

const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : -70)) : []);
const span3 = (v: unknown) => {
  const s = obj(v);
  const [a, b, l] = [num(s['start']), num(s['end']), num(s['lufs'] ?? s['maxLufs'])];
  return a !== undefined && b !== undefined ? [a, b, l ?? null] : null;
};
const MAX_CURVE_POINTS = 240;
const MAX_MASKING_PAIRS = 10;

/** analyze_loudness_curve: the short-term curve (momentary when the clip is too short), headline numbers and spans */
export function curveSummary(name: string, data: Obj): Obj {
  const curve = obj(data['shortTerm'] ?? data['momentary']);
  return {
    name,
    lufs: num(data['integratedLufs']),
    tp: num(data['truePeakDbtp']),
    lra: num(data['loudnessRangeLu']),
    plr: num(data['plrDb']),
    maxM: num(data['maxMomentaryLufs']),
    target: num(data['targetLufs']),
    start: num(data['startTime']) ?? 0,
    step: num(curve['step']),
    term: data['shortTerm'] ? 's' : 'm',
    curve: nums(curve['lufs']).slice(0, MAX_CURVE_POINTS),
    loud: span3(data['loudest']),
    quiet: span3(data['quietest']),
    over: (Array.isArray(data['overTarget']) ? (data['overTarget'] as unknown[]) : []).slice(0, 20).flatMap((s) => {
      const t = span3(s);
      return t ? [t] : [];
    }),
  };
}

/** analyze_stereo_bands: per band [name, correlation, worst, out-of-phase share, side-to-mid dB], and the flags */
export function stereoBandsSummary(name: string, data: Obj): Obj {
  const bands = Array.isArray(data['bands']) ? (data['bands'] as Obj[]) : [];
  return {
    name,
    bands: bands.map((b) => [b['band'], num(b['correlation']) ?? null, num(b['worst']) ?? null, num(b['negativeShare']) ?? null, num(b['sideToMidDb']) ?? null]),
    flags: (Array.isArray(data['flags']) ? (data['flags'] as unknown[]) : []).slice(0, 5).map(String),
    dur: num(data['durationSeconds']),
  };
}

/** measure_masking: the track names, band centres, the most masked pairs with their per-band scores, top conflicts */
export function maskingSummary(result: Obj): Obj {
  const pairs = Array.isArray(result['pairs']) ? (result['pairs'] as Obj[]) : [];
  const conflicts = Array.isArray(result['conflicts']) ? (result['conflicts'] as Obj[]) : [];
  return {
    tracks: Array.isArray(result['tracks']) ? result['tracks'] : [],
    hz: nums(result['bandsHz']),
    pairs: [...pairs].sort((x, y) => (num(y['overall']) ?? 0) - (num(x['overall']) ?? 0)).slice(0, MAX_MASKING_PAIRS)
      .map((p) => [p['a'], p['b'], num(p['overall']) ?? 0, nums(p['scores'])]),
    conflicts: conflicts.slice(0, 5).map((c) => [c['a'], c['b'], num(c['hz']) ?? null, num(c['score']) ?? null, c['suggestion']]),
  };
}

/** separate_stems: the model, device, speed and each stem's loudness and peak */
export function stemsSummary(name: string, data: Obj): Obj {
  const stems = Array.isArray(data['stems']) ? (data['stems'] as Obj[]) : [];
  const inserted = obj(data['inserted']);
  return {
    name,
    model: data['model'],
    device: data['device'],
    secs: num(data['seconds']),
    proc: num(data['processingSeconds']),
    stems: stems.map((s) => [s['stem'], num(s['lufs']) ?? null, num(s['peakDbfs']) ?? null]),
    ...(Array.isArray(inserted['tracks']) ? { inserted: (inserted['tracks'] as unknown[]).length, folder: inserted['folderName'] } : {}),
  };
}
