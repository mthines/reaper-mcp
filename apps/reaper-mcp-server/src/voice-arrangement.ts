/** A proposed 4/4 backing arrangement, not recovered audio stems or inferred song structure. */
import { PITCH_CLASSES, SCALE, type Mode } from './key.js';
import type { VoiceSketchResult } from './sidecar.js';
import type { SmfNote, SmfTrack } from './smf.js';

export interface ArrangementTrack extends SmfTrack {
  channel: number;
  program: number;
  gain: number;
  origin: 'generated' | 'detected motif repeated';
}

export interface VoiceArrangement {
  bars: number;
  meter: '4/4';
  motifBars: number;
  key: string;
  keySource: 'override' | 'estimated' | 'fallback';
  sections: { name: string; startBar: number; bars: number }[];
  chords: { bar: number; chord: string }[];
  tempos: { beat: number; bpm: number }[];
  durationSeconds: number;
  tracks: ArrangementTrack[];
}

/** Integrate the MIDI tempo map, so previews and exports agree across tempo changes. */
export function secondsAtBeat(beat: number, tempos: { beat: number; bpm: number }[]): number {
  let seconds = 0;
  for (let i = 0; i < tempos.length && tempos[i].beat < beat; i++) {
    seconds += (Math.min(beat, tempos[i + 1]?.beat ?? beat) - tempos[i].beat) * 60 / tempos[i].bpm;
  }
  return seconds;
}

export function arrangeVoiceSketch(source: VoiceSketchResult, options: {
  bars: number;
  key: { tonic: string; mode: Mode };
  keySource: VoiceArrangement['keySource'];
}): VoiceArrangement {
  const { bars, key, keySource } = options;
  const endTime = source.startTime + source.durationSeconds - source.tempo.originSeconds;
  const segments = source.tempo.segments;
  const last = segments[segments.length - 1];
  const endBeat = last.beat + (endTime - (last.time - source.tempo.originSeconds)) * last.bpm / 60;
  const motifBeats = Math.max(4, Math.ceil(endBeat / 4) * 4);
  const length = bars * 4;
  const tempos: VoiceArrangement['tempos'] = [];
  for (let start = 0; start < length; start += motifBeats) {
    for (const segment of segments) {
      const beat = start + segment.beat;
      if (beat < length && (tempos.at(-1)?.bpm !== segment.bpm)) tempos.push({ beat, bpm: segment.bpm });
    }
  }
  const tracks: ArrangementTrack[] = [
    { name: 'drums', channel: 9, program: 0, gain: 0.8, origin: 'generated', notes: [], cc: [] },
    { name: 'bass', channel: 1, program: 33, gain: 0.7, origin: 'generated', notes: [], cc: [] },
    { name: 'harmony', channel: 2, program: 4, gain: 0.4, origin: 'generated', notes: [], cc: [] },
    { name: 'melody', channel: 0, program: 11, gain: 0.8, origin: 'detected motif repeated', notes: [], cc: [] },
  ];
  const [drums, bass, harmony, melody] = tracks;
  const add = (track: ArrangementTrack, start: number, duration: number, pitch: number, velocity: number) => {
    if (start >= length || start < 0) return;
    track.notes.push({ start, length: Math.min(duration, length - start), pitch, velocity, channel: track.channel });
  };
  for (let start = 0; start < length; start += motifBeats) {
    for (const n of source.melody) add(melody, start + n.beat, n.lengthBeats, n.pitch, n.velocity);
  }

  const edgeBars = bars >= 8 ? 2 : 1;
  const chorusBar = Math.floor(bars / 2);
  const sections = [
    { name: 'intro', startBar: 1, bars: edgeBars },
    { name: 'verse', startBar: edgeBars + 1, bars: chorusBar - edgeBars },
    { name: 'chorus', startBar: chorusBar + 1, bars: bars - edgeBars - chorusBar },
    { name: 'outro', startBar: bars - edgeBars + 1, bars: edgeBars },
  ].filter(s => s.bars > 0);
  const tonic = PITCH_CLASSES.indexOf(key.tonic as typeof PITCH_CLASSES[number]);
  const scale = SCALE[key.mode];
  const progression = key.mode === 'minor' ? [0, 5, 2, 6] : [0, 5, 3, 4];
  const chords: VoiceArrangement['chords'] = [];
  // Use the detected kick positions in each source bar. Snare/hat labels are too
  // uncertain to copy literally; regular backbeats + dynamics make an editable groove.
  for (let bar = 0; bar < bars; bar++) {
    const beat = bar * 4;
    const quiet = bar < edgeBars || bar >= bars - edgeBars;
    const chorus = bar >= chorusBar && bar < bars - edgeBars;
    const sourceBeat = beat % motifBeats;
    const phrase = source.melody.filter(n => n.beat < sourceBeat + 4 && n.beat + n.lengthBeats > sourceBeat);
    let degree = progression[bar % 4];
    let best = -Infinity;
    for (let d = 0; d < 7; d++) {
      const pcs = [d, (d + 2) % 7, (d + 4) % 7].map(i => (tonic + scale[i]) % 12);
      const score = phrase.reduce((sum, n) => sum + (pcs.includes(n.pitch % 12) ? 1 : -0.7) *
        Math.max(0, Math.min(sourceBeat + 4, n.beat + n.lengthBeats) - Math.max(sourceBeat, n.beat)), 0)
        + (d === progression[bar % 4] ? 0.15 : 0) - (d === 6 && key.mode === 'major' ? 0.2 : 0);
      if (score > best) { best = score; degree = d; }
    }
    const root = (tonic + scale[degree]) % 12;
    const tones = [0, 2, 4].map(step => {
      const i = degree + step;
      return tonic + scale[i % 7] + 12 * Math.floor(i / 7);
    });
    const third = tones[1] - tones[0];
    chords.push({ bar: bar + 1, chord: `${PITCH_CLASSES[root]}${tones[2] - tones[0] === 6 ? 'dim' : third === 3 ? 'm' : ''}` });
    const voice = tones.map(p => 48 + p);
    while (voice[0] > 59) for (let i = 0; i < voice.length; i++) voice[i] -= 12;
    for (const p of voice) add(harmony, beat, 3.8, p, quiet ? 54 : chorus ? 78 : 65);

    const kickHits = source.drums.filter(n => n.pitch === 36 && n.beat >= sourceBeat && n.beat < sourceBeat + 4);
    const kicks = [...new Set([0, ...kickHits.map(n => n.beat - sourceBeat), ...(kickHits.length ? [] : [2])])].slice(0, quiet ? 2 : 5);
    for (const k of kicks) {
      add(drums, beat + k, 0.125, 36, quiet ? 77 : 105);
      add(bass, beat + k, Math.min(quiet ? 1.8 : 0.7, 4 - k), 36 + root, quiet ? 72 : 94);
    }
    for (const s of [1, 3]) add(drums, beat + s, 0.125, 38, quiet ? 60 : chorus ? 108 : 94);
    if (!quiet) {
      const ghosts = source.drums.filter(n => n.pitch === 38 && n.velocity >= 90 && n.beat >= sourceBeat && n.beat < sourceBeat + 4)
        .filter(n => [1, 3].every(s => Math.abs(n.beat - sourceBeat - s) > 0.24)).slice(0, 2);
      for (const n of ghosts) add(drums, beat + n.beat - sourceBeat, 0.125, 38, 48);
    }
    const hatStep = quiet ? 1 : 0.5;
    for (let h = 0; h < 4; h += hatStep) {
      const detected = source.drums.find(n => n.pitch === 42 && Math.abs(n.beat - sourceBeat - h) < 0.13);
      add(drums, beat + h, 0.125, chorus && h === 3.5 ? 46 : 42,
        Math.min(100, (h % 1 === 0 ? 70 : 48) + (detected ? 13 : 0)));
    }
    if (chorus && bar % 4 === 0) add(drums, beat, 0.5, 49, 100);
    if (!quiet && (bar + 1 === chorusBar || bar + 1 === bars - edgeBars)) {
      for (const [i, p] of [38, 45, 47, 50].entries()) add(drums, beat + 3 + i * 0.25, 0.125, p, 65 + i * 9);
    }
  }
  // A fill can share a snare with the backbeat. Keep one audible hit per pitch/tick.
  for (const track of tracks) {
    const unique = new Map<string, SmfNote>();
    for (const n of track.notes) {
      const id = `${n.start}:${n.pitch}`;
      if ((unique.get(id)?.velocity ?? 0) < n.velocity) unique.set(id, n);
    }
    track.notes = [...unique.values()].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    if (track.channel !== 9) {
      const previous = new Map<number, SmfNote>();
      for (const n of track.notes) {
        const before = previous.get(n.pitch);
        if (before) before.length = Math.min(before.length, n.start - before.start);
        previous.set(n.pitch, n);
      }
    }
  }
  return { bars, meter: '4/4', motifBars: motifBeats / 4, key: `${key.tonic} ${key.mode}`, keySource,
    sections, chords, tempos, durationSeconds: secondsAtBeat(length, tempos), tracks };
}
