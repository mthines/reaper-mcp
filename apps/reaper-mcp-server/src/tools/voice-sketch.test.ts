import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerVoiceSketchTools } from './voice-sketch.js';
import { getSidecarClient, type VoiceSketchResult } from '../sidecar.js';
import { parseSmf } from '../smf.js';

vi.mock('../sidecar.js', () => ({ getSidecarClient: vi.fn() }));
vi.mock('../tool-log.js', () => ({ logToolResult: vi.fn() }));

const note = (pitch: number, beat: number, lengthBeats: number) => ({
  pitch, beat, lengthBeats, time: 2 + beat * 0.5, duration: lengthBeats * 0.5, velocity: 91, confidence: 0.9,
});
const result: VoiceSketchResult = {
  durationSeconds: 12, startTime: 2, mode: 'auto', grid: 0.25,
  tempo: { bpm: 120, detectedBpm: 119.8, confidence: 0.8, source: 'estimated', originSeconds: 2,
    alternatives: [60, 240], segments: [{ time: 2, beat: 0, bpm: 120 }, { time: 6, beat: 8, bpm: 150 }] },
  chroma: [4, 0, 1, 0, 3, 1, 0, 3.5, 0, 1, 0, 0.5],
  melody: [note(60, 0, 1), note(60, 1, 0.5), note(67, 8.25, 0.75)],
  drums: [note(36, 0, 0.125), note(38, 1.5, 0.125)],
  warnings: ['Review drum guesses'], patterns: [],
};

let client: Client;
let server: McpServer;
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'voice-sketch-'));
  vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => true,
    transcribeVoiceSketch: async () => structuredClone(result) } as never);
  server = new McpServer({ name: 'voice-sketch-test', version: '1' });
  registerVoiceSketchTools(server);
  client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
});
afterEach(async () => {
  await client.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

async function call(args: Record<string, unknown>) {
  const response = await client.callTool({ name: 'transcribe_voice_sketch', arguments: { path: '/music/voice.mp3', ...args } });
  const message = (response.content as { type: string; text: string }[])[0].text;
  return { response, message, data: response.isError ? null : JSON.parse(message) };
}

describe('voice sketch tool', () => {
  it('exports every note and tempo while paging the reply, including adjacent repeated pitches and drum channels', async () => {
    const outputPath = join(dir, 'sketch.mid');
    const { response, data } = await call({ outputPath, arrange: false, offset: '1', limit: '1' });
    expect(response.isError).toBeUndefined();
    expect(data.melody).toMatchObject({ total: 3, offset: 1, hasMore: true, notes: [result.melody[1]] });
    expect(data.drums).toMatchObject({ total: 2, offset: 1, hasMore: false, notes: [result.drums[1]] });
    expect(data.key.key).toBe('C major');
    expect(data.midi).toMatchObject({ notes: 5, tracks: 2, tempoIncluded: true, projectChanged: false });
    const file = parseSmf(await readFile(outputPath));
    expect(file).toMatchObject({ format: 1, ppq: 960, tempo: 120, tempoChanges: 2, timeSignature: [4, 4] });
    expect(file.tracks.map(t => t.name)).toEqual(['melody', 'drums']);
    expect(file.tracks[0].notes).toEqual([
      { start: 0, length: 1, pitch: 60, channel: 0, velocity: 91 },
      { start: 1, length: 0.5, pitch: 60, channel: 0, velocity: 91 },
      { start: 8.25, length: 0.75, pitch: 67, channel: 0, velocity: 91 },
    ]);
    expect(file.tracks[1].notes.map(n => [n.start, n.pitch, n.channel])).toEqual([[0, 36, 9], [1.5, 38, 9]]);
    expect((await call({ limit: 0 })).data.melody).toMatchObject({ total: 3, notes: [], hasMore: true });
  });

  it('proposes a full band with kick-led bass, backbeats, dynamics and key override without retuning the detected motif', async () => {
    const outputPath = join(dir, 'band.mid');
    const { response, data } = await call({ outputPath, key: 'Eb minor', bars: '16', limit: 0 });
    expect(response.isError).toBeUndefined();
    expect(data.arrangement).toMatchObject({ bars: 16, motifBars: 7, meter: '4/4',
      key: 'Eb minor', keySource: 'override', durationSeconds: 28 });
    expect(data.key.key).toBe('C major');
    expect(data.arrangement.sections.map((s: { name: string }) => s.name)).toEqual(['intro', 'verse', 'chorus', 'outro']);
    expect(data.arrangement.tracks.every((t: { notes: unknown[] }) => t.notes.length === 0)).toBe(true);
    const file = parseSmf(await readFile(outputPath));
    expect(file.skipped.programChange).toBe(4);
    const [drums, bass, harmony, melody] = file.tracks;
    expect(file.tracks.map(t => t.name)).toEqual(['drums', 'bass', 'harmony', 'melody']);
    expect(melody.notes.slice(0, 3).map(n => [n.pitch, n.start])).toEqual([[60, 0], [60, 1], [67, 8.25]]);
    expect(melody.notes[3]).toMatchObject({ pitch: 60, start: 28 });
    const kickBeats = drums.notes.filter(n => n.pitch === 36).map(n => n.start);
    expect(bass.notes.every(n => kickBeats.includes(n.start))).toBe(true);
    expect([...new Set(harmony.notes.map(n => n.pitch % 12))].every(pc => [3, 5, 6, 8, 10, 11, 1].includes(pc))).toBe(true);
    expect(drums.notes.filter(n => n.pitch === 38).map(n => n.start)).toContain(33);
    expect(new Set(drums.notes.filter(n => n.pitch === 42).map(n => n.velocity)).size).toBeGreaterThan(1);
    expect(file.lengthQN).toBeLessThanOrEqual(64);
    expect(data.warnings.join(' ')).toContain('generated proposals');
  });

  it('uses actual syncopated kick positions, and reports a preview failure while keeping usable MIDI', async () => {
    const mixed = structuredClone(result);
    mixed.drums.push(note(36, 2.75, 0.125));
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => true,
      transcribeVoiceSketch: async () => mixed,
      renderVoiceArrangement: async () => { throw new Error('Install FluidSynth'); } } as never);
    const outputPath = join(dir, 'partial.mid');
    const { response, data } = await call({ outputPath, soundfontPath: '/fonts/gm.sf2', bars: 8 });
    expect(response.isError).toBeUndefined();
    expect(data.preview.error).toContain('Install FluidSynth');
    const file = parseSmf(await readFile(outputPath));
    expect(file.tracks[0].notes).toContainEqual(expect.objectContaining({ start: 2.75, pitch: 36 }));
    expect(file.tracks[1].notes).toContainEqual(expect.objectContaining({ start: 2.75 }));
    expect(data.warnings.join(' ')).toContain('preview failed');
  });

  it('never overwrites an existing file and reports missing sidecar or failed analysis without success', async () => {
    const path = join(dir, 'existing.mid');
    await writeFile(path, 'keep me');
    expect((await call({ outputPath: path })).response.isError).toBe(true);
    expect(await readFile(path, 'utf8')).toBe('keep me');
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => false } as never);
    expect((await call({})).message).toContain('setup-sidecar');
    vi.mocked(getSidecarClient).mockReturnValue({ isAvailable: () => true,
      transcribeVoiceSketch: async () => { throw new Error('No reliable pulse found. Supply bpm'); } } as never);
    expect((await call({})).message).toContain('Supply bpm');
  });

  it('refuses invalid ranges, pitch limits and output paths', async () => {
    for (const args of [{ path: 'relative.mp3' }, { startTime: 3, endTime: 2 }, { endTime: 121 },
      { pitchMin: 70, pitchMax: 50 }, { outputPath: '/music/source.mp3' }, { soundfontPath: '/font.sf2' },
      { outputPath: '/music/song.mid', soundfontPath: '../font.sf2' }]) {
      expect((await call(args)).response.isError).toBe(true);
    }
    expect((await call({ bpm: '0' })).response.isError).toBe(true);
  });
});
