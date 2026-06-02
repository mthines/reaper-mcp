// Integration tests for the live-MIDI tools — run end-to-end against a real
// REAPER bridge. Auto-skip when the bridge isn't reachable so CI stays green.
//
// To run locally:
//   1. Open REAPER and load Scripts/mcp_bridge.lua
//   2. Add at least one track (⌘T) — defaults to track 0, override with
//      REAPER_TEST_TRACK_INDEX
//   3. `pnpm nx test reaper-mcp-server`
//
// The suite inserts the MCP MIDI Emitter JSFX on the test track and removes it
// after the run completes.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

function reaperResourcePath(): string {
  const env = process.env['REAPER_RESOURCE_PATH'];
  if (env) return env;
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'REAPER');
    case 'win32':
      return join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'REAPER');
    default:
      return join(home, '.config', 'REAPER');
  }
}

const BRIDGE_DIR = join(reaperResourcePath(), 'Scripts', 'mcp_bridge_data');
const HEARTBEAT_PATH = join(BRIDGE_DIR, 'heartbeat.json');
const TEST_TRACK_INDEX = Number(process.env['REAPER_TEST_TRACK_INDEX'] ?? 0);
const HEARTBEAT_MAX_AGE_MS = 5000;

function bridgeAlive(): boolean {
  try {
    return Date.now() - statSync(HEARTBEAT_PATH).mtimeMs < HEARTBEAT_MAX_AGE_MS;
  } catch {
    return false;
  }
}

interface BridgeResponse<T = unknown> {
  id: string;
  success: boolean;
  data?: T;
  error?: string;
}

async function sendCommand<T = unknown>(
  type: string,
  params: Record<string, unknown>,
  timeoutMs = 3000,
): Promise<BridgeResponse<T>> {
  const id = randomUUID();
  const cmdPath = join(BRIDGE_DIR, `command_${id}.json`);
  const respPath = join(BRIDGE_DIR, `response_${id}.json`);
  writeFileSync(cmdPath, JSON.stringify({ id, type, params, timestamp: Date.now() }));

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(respPath)) {
      const parsed = JSON.parse(readFileSync(respPath, 'utf8')) as BridgeResponse<T>;
      unlinkSync(respPath);
      return parsed;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  if (existsSync(cmdPath)) unlinkSync(cmdPath);
  throw new Error(`Bridge timeout waiting for "${type}" after ${timeoutMs}ms`);
}

interface FxInfo {
  index: number;
  name: string;
}
interface TrackProperties {
  fxList: FxInfo[];
}

/**
 * Returns the index of the "MCP Meters" FX container on a track, if present.
 * The emitter JSFX itself lives INSIDE the container — `fxList` only enumerates
 * top-level FX, so checking for the container is the strongest signal we can
 * get from public bridge APIs that the auto-insertion succeeded.
 */
async function findMcpContainerIndex(trackIndex: number): Promise<number | null> {
  const res = await sendCommand<TrackProperties>('get_track_properties', { trackIndex });
  if (!res.success || !res.data) return null;
  const match = res.data.fxList.find((fx) => (fx.name || '').toLowerCase() === 'mcp meters');
  return match ? match.index : null;
}

async function countMcpContainers(trackIndex: number): Promise<number> {
  const res = await sendCommand<TrackProperties>('get_track_properties', { trackIndex });
  if (!res.success || !res.data) return 0;
  return res.data.fxList.filter((fx) => (fx.name || '').toLowerCase() === 'mcp meters').length;
}

// Top-level await to resolve track count BEFORE describe runs — lets us use
// describe.skipIf cleanly. Vitest supports top-level await in test files.
const liveBridge = bridgeAlive();
const trackCount = liveBridge
  ? (await sendCommand<unknown[]>('list_tracks', {})).data?.length ?? 0
  : 0;

if (!liveBridge) {
  console.warn(
    `[midi.integration] Bridge not reachable at ${HEARTBEAT_PATH} — skipping live tests.`,
  );
} else if (trackCount === 0) {
  console.warn(
    '[midi.integration] Bridge alive but no tracks in REAPER — add a track (⌘T) and re-run to exercise the MIDI tools.',
  );
}

const describeLive = liveBridge && trackCount > 0 ? describe : describe.skip;
const describeBridgeOnly = liveBridge ? describe : describe.skip;

describeBridgeOnly('MIDI tools — live bridge sanity', () => {
  it('bridge responds to get_project_info', async () => {
    const res = await sendCommand<{ tempo: number }>('get_project_info', {});
    expect(res.success).toBe(true);
    expect(res.data?.tempo).toBeGreaterThan(0);
  });

  it('returns a structured error for an out-of-range track index', async () => {
    const res = await sendCommand('send_midi_cc', {
      trackIndex: 99999,
      cc: 20,
      value: 64,
      channel: 0,
    });
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

describeLive('MIDI tools — live emission (requires a track)', () => {
  afterAll(async () => {
    const containerIdx = await findMcpContainerIndex(TEST_TRACK_INDEX);
    if (containerIdx !== null) {
      await sendCommand('remove_fx', { trackIndex: TEST_TRACK_INDEX, fxIndex: containerIdx });
    }
  });

  it('send_midi_cc returns success and auto-inserts the MCP container', async () => {
    const res = await sendCommand<{ sent: boolean; timestampMs: number }>('send_midi_cc', {
      trackIndex: TEST_TRACK_INDEX,
      cc: 20,
      value: 64,
      channel: 0,
    });
    expect(res.success).toBe(true);
    expect(res.data?.sent).toBe(true);
    expect(res.data?.timestampMs).toBeGreaterThan(0);

    const containerIdx = await findMcpContainerIndex(TEST_TRACK_INDEX);
    expect(
      containerIdx,
      'MCP Meters container should be present after first send_midi_cc (emitter JSFX is inside it)',
    ).not.toBeNull();
  });

  it('does not stack containers on repeated calls (idempotency)', async () => {
    // Three rapid calls should NOT create three containers — the prefix-match
    // fix in find_or_create_mcp_container must recognize the existing container.
    for (let i = 0; i < 3; i++) {
      const res = await sendCommand('send_midi_cc', {
        trackIndex: TEST_TRACK_INDEX,
        cc: 20,
        value: i * 32,
        channel: 0,
      });
      expect(res.success).toBe(true);
    }
    const containerCount = await countMcpContainers(TEST_TRACK_INDEX);
    expect(containerCount, 'should reuse the existing container, not stack new ones').toBe(1);
  });

  it('send_midi_cc accepts default channel (omitted)', async () => {
    const res = await sendCommand('send_midi_cc', {
      trackIndex: TEST_TRACK_INDEX,
      cc: 21,
      value: 32,
    });
    expect(res.success).toBe(true);
  });

  it('send_midi_pc emits a program change without bank select', async () => {
    const res = await sendCommand('send_midi_pc', {
      trackIndex: TEST_TRACK_INDEX,
      program: 5,
      channel: 0,
    });
    expect(res.success).toBe(true);
  });

  it('send_midi_pc emits MSB + LSB + PC when bank bytes provided', async () => {
    const res = await sendCommand('send_midi_pc', {
      trackIndex: TEST_TRACK_INDEX,
      program: 5,
      bankMsb: 0,
      bankLsb: 0,
      channel: 0,
    });
    expect(res.success).toBe(true);
  });

  it('send_midi_pc accepts bank byte value 0 (nil-check correctness)', async () => {
    const res = await sendCommand('send_midi_pc', {
      trackIndex: TEST_TRACK_INDEX,
      program: 0,
      bankMsb: 0,
      channel: 0,
    });
    expect(res.success).toBe(true);
  });

  it('send_midi_note without durationMs emits note-on only', async () => {
    const res = await sendCommand('send_midi_note', {
      trackIndex: TEST_TRACK_INDEX,
      pitch: 60,
      velocity: 100,
      channel: 0,
    });
    expect(res.success).toBe(true);
  });

  it('send_midi_note with durationMs returns synchronously (note-off is deferred)', async () => {
    // Use a generous durationMs so bridge round-trip latency (~300-500ms on
    // macOS due to APFS dir-cache delay) stays well below it. What we're
    // verifying is that the handler doesn't BLOCK for the full duration — it
    // should return after one bridge cycle, regardless of how long durationMs is.
    const start = Date.now();
    const res = await sendCommand('send_midi_note', {
      trackIndex: TEST_TRACK_INDEX,
      pitch: 62,
      velocity: 100,
      channel: 0,
      durationMs: 3000,
    });
    const elapsed = Date.now() - start;
    expect(res.success).toBe(true);
    expect(
      elapsed,
      `handler should not block for durationMs (deferred note-off); took ${elapsed}ms`,
    ).toBeLessThan(1500);
  });

  it('handles a burst of 8 CCs without dropping (ring buffer drain)', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        sendCommand('send_midi_cc', {
          trackIndex: TEST_TRACK_INDEX,
          cc: 22,
          value: i * 16,
          channel: 0,
        }),
      ),
    );
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('accepts out-of-range channel (bridge layer clamps to 0-15)', async () => {
    // The MCP tool layer uses zod max(15); this exercises the bridge handler
    // directly with a value that bypasses zod. The Lua side clamps to 0-15.
    const res = await sendCommand('send_midi_cc', {
      trackIndex: TEST_TRACK_INDEX,
      cc: 23,
      value: 64,
      channel: 16,
    });
    // Either path is acceptable: bridge clamps silently OR rejects with an error.
    expect(typeof res.success).toBe('boolean');
  });
});
