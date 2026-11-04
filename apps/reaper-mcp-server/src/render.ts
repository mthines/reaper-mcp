/**
 * Renders of tracks for the analysis tools. REAPER can only render through its progress window,
 * which takes focus, so the bridge caches renders until the project changes and renders several
 * tracks in one pass (mcp_render_lib.lua). The bridge owns the files it hands out: a tool reads
 * the WAV and calls discardRender() when done, which leaves a cache-owned file alone.
 */
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import type { RenderTrackToWavResult, RenderTracksToWavResult } from '@reaper-mcp/protocol';
import { sendCommand } from './bridge.js';

/** Render is synchronous in REAPER: allow ~1 s per 3 s of audio plus slack. */
export const renderTimeoutMs = (seconds: number) => 30_000 + seconds * 400;

/** Render one track (-1 = the master); throws `Render failed: …`. */
export async function renderTrack(trackIndex: number, startTime: number, endTime: number): Promise<RenderTrackToWavResult> {
  const res = await sendCommand(
    'render_track_to_wav',
    { trackIndex, startTime, endTime, commandId: randomUUID() },
    renderTimeoutMs(endTime - startTime),
  );
  if (!res.success) throw new Error(`Render failed: ${res.error}`);
  return res.data as RenderTrackToWavResult;
}

/**
 * Render several tracks in one pass (one progress window instead of one per track), in the order
 * given; throws `Render failed: …`. A bridge that predates the command renders them one by one.
 */
export async function renderTracks(trackIndices: number[], startTime: number, endTime: number): Promise<RenderTrackToWavResult[]> {
  if (trackIndices.length === 1) return [await renderTrack(trackIndices[0], startTime, endTime)];
  const res = await sendCommand(
    'render_tracks_to_wav',
    { trackIndices, startTime, endTime, commandId: randomUUID() },
    renderTimeoutMs((endTime - startTime) * trackIndices.length),
  );
  if (res.success) return (res.data as RenderTracksToWavResult).tracks;
  if (/Unknown command type/.test(res.error ?? '')) {
    const out: RenderTrackToWavResult[] = [];
    try {
      for (const t of trackIndices) out.push(await renderTrack(t, startTime, endTime));
    } catch (err) {
      await Promise.all(out.map(discardRender));
      throw err;
    }
    return out;
  }
  throw new Error(`Render failed: ${res.error}`);
}

/** Done with a render: delete it, unless the bridge's cache owns it (it may hand it out again). */
export async function discardRender(wav: Pick<RenderTrackToWavResult, 'wavPath' | 'cacheOwned'>): Promise<void> {
  if (wav.cacheOwned) return;
  await unlink(wav.wavPath).catch(() => {
    // Best-effort: the OS temp dir is cleaned eventually
  });
}
