/**
 * Behaviour tests for render.ts: what the server asks the bridge for when a tool wants a track's audio,
 * and what it hands back. The bridge is stubbed at the boundary; the assertions are on the answers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./bridge.js', () => ({ sendCommand: vi.fn() }));
vi.mock('node:fs/promises', () => ({ unlink: vi.fn() }));

import { sendCommand } from './bridge.js';
import { unlink } from 'node:fs/promises';
import { renderTrack, renderTracks } from './render.js';

const sendCommandMock = sendCommand as unknown as ReturnType<typeof vi.fn>;
const unlinkMock = unlink as unknown as ReturnType<typeof vi.fn>;

let n = 0;
const wav = (trackIndex: number, extra: Record<string, unknown> = {}) =>
  ({ trackIndex, trackName: `T${trackIndex}`, wavPath: `/tmp/w${n++}.wav`, durationSeconds: 10, sampleRate: 44100, channelCount: 2, ...extra });
const ok = (data: unknown) => ({ id: 'x', success: true, timestamp: 0, data });

/** What the bridge was asked in call number `i` */
const asked = (i: number) => sendCommandMock.mock.calls[i][1] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  n = 0;
  delete process.env['REAPER_MCP_DRY_READ'];
  unlinkMock.mockResolvedValue(undefined);
});
afterEach(() => {
  delete process.env['REAPER_MCP_DRY_READ'];
});

describe('renderTrack', () => {
  it('asks for a real render unless the caller wants a dry read', async () => {
    sendCommandMock.mockResolvedValue(ok(wav(2)));
    await renderTrack(2, 0, 10);
    expect(asked(0)).not.toHaveProperty('dry');
  });

  it('asks the bridge to read the track\'s own audio when the caller wants a dry read', async () => {
    sendCommandMock.mockResolvedValue(ok(wav(2, { dry: true })));
    const res = await renderTrack(2, 0, 10, { dry: true });
    expect(asked(0)).toMatchObject({ trackIndex: 2, startTime: 0, endTime: 10, dry: true });
    expect(res.dry).toBe(true);
  });

  it('goes back to rendering everything when REAPER_MCP_DRY_READ is 0', async () => {
    process.env['REAPER_MCP_DRY_READ'] = '0';
    sendCommandMock.mockResolvedValue(ok(wav(2)));
    await renderTrack(2, 0, 10, { dry: true });
    expect(asked(0)).not.toHaveProperty('dry');
  });

  it('hands back a plain render from a bridge that does not know dry reads', async () => {
    sendCommandMock.mockResolvedValue(ok(wav(2))); // an older bridge ignores the flag and renders
    const res = await renderTrack(2, 0, 10, { dry: true });
    expect(res.dry).toBeUndefined();
    expect(res.wavPath).toMatch(/^\/tmp\/w/);
  });

  it('still says why a render failed', async () => {
    sendCommandMock.mockResolvedValue({ id: 'x', success: false, error: 'Track 9 not found', timestamp: 0 });
    await expect(renderTrack(9, 0, 10, { dry: true })).rejects.toThrow('Render failed: Track 9 not found');
  });
});

describe('renderTracks', () => {
  it('passes the dry read on to a pass over several tracks', async () => {
    sendCommandMock.mockResolvedValue(ok({ tracks: [wav(1, { dry: true }), wav(2, { dry: true })], rendered: 0, cached: 0, dryRead: 2 }));
    const res = await renderTracks([1, 2], 0, 10, { dry: true });
    expect(sendCommandMock.mock.calls[0][0]).toBe('render_tracks_to_wav');
    expect(asked(0)).toMatchObject({ trackIndices: [1, 2], dry: true });
    expect(res.map((r) => r.dry)).toEqual([true, true]);
  });
});
