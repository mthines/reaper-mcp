/**
 * The master track as trackIndex -1: the bridge's GetTrack wrapper (run in real
 * Lua 5.4 via wasmoon) and the tool schemas that now accept -1.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';
import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('./bridge.js', () => ({ sendCommand: vi.fn() }));

import { registerTrackTools } from './tools/tracks.js';
import { registerFxTools } from './tools/fx.js';
import { registerMeterTools } from './tools/meters.js';
import { registerAnalysisTools } from './tools/analysis.js';
import { registerRoutingTools } from './tools/routing.js';
import { registerEnvelopeTools } from './tools/envelopes.js';
import { registerPresetTools } from './tools/presets.js';
import { registerMediaTools } from './tools/media.js';

const BRIDGE_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_bridge.lua'), 'utf8');

/** The `do ... end` block right after the comment that introduces the wrapper. */
function wrapperSlice(): string {
  const start = BRIDGE_SRC.indexOf('-- Track index -1 means the master track');
  const end = BRIDGE_SRC.indexOf('\nend\n', start);
  expect(start).toBeGreaterThan(-1);
  return BRIDGE_SRC.slice(start, end + 5);
}

function schemas(register: (s: McpServer) => void): Record<string, z.ZodObject> {
  const out: Record<string, z.ZodObject> = {};
  const server = {
    tool: (name: string, _d: string, shape: z.ZodRawShape) => { out[name] = z.object(shape); },
  } as unknown as McpServer;
  register(server);
  return out;
}

describe('master track', () => {
  it('master: trackIndex -1 reaches the master in the bridge and in the tool schemas', async () => {
    const lua = await new LuaFactory().createEngine();
    try {
      await lua.doString(`
        local tracks = { "Kick", "Snare" }
        reaper = {
          GetTrack = function(_, i) return tracks[i + 1] end,
          GetMasterTrack = function() return "MASTER" end,
        }
      `);
      await lua.doString(wrapperSlice());
      await lua.doString(`
        assert(reaper.GetTrack(0, -1) == "MASTER", "-1 is the master")
        assert(reaper.GetTrack(0, 0) == "Kick" and reaper.GetTrack(0, 1) == "Snare", "indices >= 0 unchanged")
        assert(reaper.GetTrack(0, 2) == nil and reaper.GetTrack(0, -2) == nil, "out of range still nil")
      `);
    } finally {
      lua.global.close();
    }

    const all = {
      ...schemas(registerTrackTools), ...schemas(registerFxTools), ...schemas(registerMeterTools),
      ...schemas(registerAnalysisTools), ...schemas(registerRoutingTools), ...schemas(registerEnvelopeTools),
      ...schemas(registerPresetTools),
    };
    const masterTools = Object.entries(all).filter(([, s]) => 'trackIndex' in s.shape);
    expect(masterTools.map(([n]) => n)).toEqual(expect.arrayContaining([
      'get_track_properties', 'set_track_property', 'add_fx', 'set_fx_parameter',
      'read_track_meters', 'read_track_lufs', 'get_track_routing', 'create_track_envelope',
    ]));
    for (const [name, schema] of masterTools) {
      const idx = schema.shape['trackIndex'];
      expect(idx.safeParse(-1).success, `${name} accepts -1`).toBe(true);
      expect(idx.safeParse(-2).success, `${name} rejects -2`).toBe(false);
    }

    // The master holds no items: item tools keep rejecting -1.
    const media = schemas(registerMediaTools);
    expect(media['list_media_items'].shape['trackIndex'].safeParse(-1).success).toBe(false);
  });
});
