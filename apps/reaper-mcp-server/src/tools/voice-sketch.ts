import { z } from 'zod/v4';
import { writeFile } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSidecarClient, type VoiceSketchNote, type VoiceRenderResult } from '../sidecar.js';
import { estimateKey, type Mode } from '../key.js';
import { writeSmf, type SmfTrack } from '../smf.js';
import { logToolResult } from '../tool-log.js';
import { arrangeVoiceSketch, secondsAtBeat } from '../voice-arrangement.js';

export function registerVoiceSketchTools(server: McpServer): void {
  server.tool(
    'transcribe_voice_sketch',
    'Compose an editable musical draft from humming, singing, beatboxing, or a mixture. ' +
    'Local Python sidecar, no model download. Returns stable rounded BPM, sustained tempo changes, tentative key, ' +
    'separate monophonic melody and GM drum notes, repeated 4/4 drum patterns, and original file times. ' +
    'Timing snaps to a shared grid (default sixteenths); pitches snap to semitones, NOT to a guessed key. ' +
    'By default arrange:true adds a proposed intro/verse/chorus/outro, a kick/snare/hat groove using detected kick ' +
    'positions and hat accents, chord accompaniment, bass locked to the kicks, and the repeated detected melody. ' +
    'Those backing parts and sections are GENERATED, not recovered from the recording. No true audio source separation. ' +
    'arrange:false exports only the detected melody/percussion. key overrides accompaniment only, never retunes the melody. ' +
    'Experimental: drum labels and octaves need review; speech is not removed. Use startTime/endTime to isolate music. ' +
    'No REAPER changes. outputPath writes the FULL score as a type-1 .mid with tempo map and GM instruments. ' +
    'With soundfontPath also renders a sampled mix and separate 32-bit WAV instrument stems into <outputPath without .mid>-stems/. ' +
    'This optional preview needs the FluidSynth shared library and a user-supplied GM .sf2; no audio device or REAPER needed. ' +
    'Then use import_midi_file(newTracks:true) and assign instruments. That importer skips GM programs and ' +
    'does NOT apply the file tempo: use set_project_tempo/add_tempo_marker separately, or REAPER native MIDI import. ' +
    'Summary-first: note arrays default to 100 events per part; limit:0 returns only summaries. Export is never paginated. ' +
    'At most 120 seconds input, 64 bars output, 240 seconds for previews. Requires setup-sidecar (core only is enough).',
    {
      path: z.string().min(1).describe('Absolute path of a voice recording (MP3/WAV/FLAC/AIFF/OGG)'),
      startTime: z.coerce.number().min(0).optional().describe('Start in file seconds (default 0); exclude spoken cues'),
      endTime: z.coerce.number().positive().optional().describe('End in file seconds (default end of file, max 120 seconds selected)'),
      mode: z.enum(['auto', 'melody', 'drums']).default('auto').describe('auto: both layers, melody: humming only, drums: beatboxing only'),
      bpm: z.coerce.number().min(40).max(240).optional().describe('Force one fixed tempo; use for short clips or half/double-time ambiguity'),
      grid: z.coerce.number().min(1 / 12).max(1).default(0.25).describe('Grid in quarter-note beats: 0.25 sixteenths, 0.5 eighths, 1/3 triplets'),
      pitchMin: z.coerce.number().int().min(24).max(95).default(36).describe('Lowest vocal MIDI pitch (default C2 = 36)'),
      pitchMax: z.coerce.number().int().min(25).max(96).default(84).describe('Highest vocal MIDI pitch (default C6 = 84)'),
      minNoteMs: z.coerce.number().min(40).max(500).default(80).describe('Shortest stable pitched segment before quantization (default 80 ms)'),
      tempoChangeThreshold: z.coerce.number().min(0.1).max(0.5).default(0.2).describe('Minimum relative tempo change, persisting in two 4-second windows (default 0.2 = 20%)'),
      arrange: z.boolean().default(true).describe('Generate a full backing arrangement; false returns the raw detected sketch only'),
      bars: z.coerce.number().int().min(4).max(64).default(16).describe('Generated arrangement length in 4/4 bars (default 16); ignored with arrange:false'),
      key: z.string().regex(/^(C|C#|D|Eb|E|F|F#|G|Ab|A|Bb|B) (major|minor)$/).optional().describe('Optional accompaniment key, e.g. A minor or Eb major. Does not change detected melody'),
      outputPath: z.string().min(1).optional().describe('Optional absolute .mid path to create. Parent folder must exist. Existing files are never overwritten'),
      soundfontPath: z.string().min(1).optional().describe('Optional absolute GM .sf2 for real sampled mix + stems. Requires outputPath and local FluidSynth library'),
      offset: z.coerce.number().int().min(0).default(0).describe('Note offset, independently in each part'),
      limit: z.coerce.number().int().min(0).max(500).default(100).describe('Notes returned per part (default 100, 0 = summary only); export always includes all notes'),
    },
    async (args) => {
      const started = Date.now();
      const fail = (message: string) => {
        logToolResult('transcribe_voice_sketch', args, started, null, message);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      };
      if (!isAbsolute(args.path)) return fail('path must be absolute');
      if (args.outputPath && (!isAbsolute(args.outputPath) || extname(args.outputPath).toLowerCase() !== '.mid')) {
        return fail('outputPath must be an absolute .mid path');
      }
      if (args.soundfontPath && (!args.outputPath || !isAbsolute(args.soundfontPath) || extname(args.soundfontPath).toLowerCase() !== '.sf2')) {
        return fail('soundfontPath must be an absolute .sf2 path and requires outputPath');
      }
      if (args.endTime !== undefined && args.endTime <= (args.startTime ?? 0)) return fail('endTime must be greater than startTime');
      if (args.endTime !== undefined && args.endTime - (args.startTime ?? 0) > 120) return fail('Select at most 120 seconds per call');
      if (args.pitchMin >= args.pitchMax) return fail('pitchMin must be below pitchMax');
      const sidecar = getSidecarClient();
      if (!sidecar.isAvailable()) return fail('Audio sidecar not installed. Run reaper-mcp setup-sidecar --without-aesthetics');
      try {
        const { outputPath, soundfontPath, arrange, bars, key: keyOverride, offset, limit, ...params } = args;
        const result = await sidecar.transcribeVoiceSketch(params);
        const key = estimateKey(result.chroma);
        const [tonic, mode] = (keyOverride ?? key?.key ?? 'C minor').split(' ');
        const arrangement = arrange ? arrangeVoiceSketch(result, {
          bars, key: { tonic, mode: mode as Mode }, keySource: keyOverride ? 'override' : key ? 'estimated' : 'fallback',
        }) : null;
        const tracks: SmfTrack[] = arrangement?.tracks ?? [];
        if (!arrangement) {
          for (const [name, notes, channel] of [['melody', result.melody, 0], ['drums', result.drums, 9]] as const) {
            if (!notes.length) continue;
            tracks.push({ name, cc: [], channel, program: 0,
              notes: notes.map(n => ({ start: n.beat, length: n.lengthBeats, channel, pitch: n.pitch, velocity: n.velocity })) });
          }
        }
        const tempos = arrangement?.tempos ?? result.tempo.segments;
        const duration = arrangement?.durationSeconds ?? secondsAtBeat(Math.max(...tracks.flatMap(t => t.notes.map(n => n.start + n.length))), tempos);
        if (soundfontPath && duration + 2 > 240) return fail('Preview is limited to 240 seconds including a 2-second tail; reduce bars or select a shorter range');
        if (outputPath) await writeFile(outputPath, writeSmf(tracks, tempos), { flag: 'wx' });
        const warnings = [...result.warnings, ...(key && key.confidence < 0.4 ? ['Key is uncertain; do not force notes into this scale.'] : [])];
        if (arrangement) warnings.push('Backing parts and song sections are generated proposals. Instrument stems are resynthesized, not isolated original voice audio.');
        if (arrangement?.keySource === 'fallback') warnings.push('No reliable melodic key found; generated accompaniment uses C minor. Supply key to choose another.');
        let preview: VoiceRenderResult | { error: string } | undefined;
        if (soundfontPath && outputPath) {
          try {
            preview = await sidecar.renderVoiceArrangement({ soundfontPath, outDir: `${outputPath.slice(0, -4)}-stems`, durationSeconds: duration + 2,
              tracks: tracks.map(t => ({ name: t.name, channel: t.channel ?? 0, program: t.program ?? 0,
                gain: arrangement?.tracks.find(a => a.name === t.name)?.gain ?? 0.8,
                notes: t.notes.map(n => ({ time: secondsAtBeat(n.start, tempos),
                  duration: secondsAtBeat(n.start + n.length, tempos) - secondsAtBeat(n.start, tempos), pitch: n.pitch, velocity: n.velocity })) })) });
          } catch (err) {
            preview = { error: err instanceof Error ? err.message : String(err) };
            warnings.push('MIDI was exported, but the sampled preview failed. See preview.error; the MIDI file was kept.');
          }
        }
        const part = (notes: VoiceSketchNote[]) => ({
          total: notes.length, offset, hasMore: offset + limit < notes.length,
          pitchRange: notes.length ? [Math.min(...notes.map(n => n.pitch)), Math.max(...notes.map(n => n.pitch))] : null,
          notes: notes.slice(offset, offset + limit),
        });
        logToolResult('transcribe_voice_sketch', args, started, null);
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          source: { path: args.path, startTime: result.startTime, durationSeconds: result.durationSeconds },
          mode: result.mode, grid: result.grid, tempo: result.tempo, key,
          melody: part(result.melody), drums: part(result.drums),
          arrangement: arrangement ? { ...arrangement, tracks: arrangement.tracks.map(t => ({
            name: t.name, channel: t.channel, program: t.program, gain: t.gain, origin: t.origin,
            total: t.notes.length, offset, hasMore: offset + limit < t.notes.length, notes: t.notes.slice(offset, offset + limit),
          })) } : null,
          patterns: { total: result.patterns.length, patterns: result.patterns.slice(0, 32).map(p => ({
            bars: p.bars, totalHits: p.hits.length, hits: p.hits.slice(0, 64),
          })), truncated: result.patterns.length > 32 },
          ...(outputPath ? { midi: { path: outputPath, tracks: tracks.length, notes: tracks.reduce((n, t) => n + t.notes.length, 0),
            tempoIncluded: true, projectChanged: false } } : {}),
          ...(preview ? { preview } : {}), warnings,
        }, null, 2) }] };
      } catch (err) {
        return fail(`Voice transcription failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}
