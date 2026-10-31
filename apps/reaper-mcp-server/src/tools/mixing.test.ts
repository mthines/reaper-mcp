/**
 * What the mixing tools answer the agent, through a stubbed bridge (and a stubbed sidecar
 * for quantize_audio). The bridge's own behaviour is tested in mixing-lib.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod/v4';

vi.mock('../bridge.js', () => ({ sendCommand: vi.fn() }));
vi.mock('../sidecar.js', () => ({ getSidecarClient: vi.fn() }));

import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMixingTools } from './mixing.js';

const sendCommandMock = vi.mocked(sendCommand);
type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type ToolCallback = (params: Record<string, unknown>) => Promise<ToolResult>;

function tool(n: string): ToolCallback {
  const tools: Record<string, ToolCallback> = {};
  registerMixingTools({ tool: (t: string, _d: string, _s: unknown, cb: ToolCallback) => { tools[t] = cb; } } as unknown as McpServer);
  return tools[n];
}
const json = (r: ToolResult) => JSON.parse(r.content[0].text);
const ok = (data: unknown) => ({ id: 't', success: true, data, timestamp: 0 });
const fail = (error: string) => ({ id: 't', success: false, error, timestamp: 0 });

function sidecar(transients: { time: number; strength: number }[] | Error, available = true) {
  const client = {
    isAvailable: () => available,
    transients: vi.fn(async () => {
      if (transients instanceof Error) throw transients;
      return { transients };
    }),
  };
  vi.mocked(getSidecarClient).mockReturnValue(client as unknown as ReturnType<typeof getSidecarClient>);
  return client;
}

beforeEach(() => {
  sendCommandMock.mockReset().mockResolvedValue(ok({}));
  vi.mocked(getSidecarClient).mockReset();
});

describe('mixing tools: bridge results', () => {
  it('returns what the bridge reports for a pin change, and its refusal as an error', async () => {
    sendCommandMock.mockResolvedValueOnce(ok({ trackChannels: 4, trackChannelsBefore: 2, inputs: [] }));
    const res = await tool('set_fx_pins')({ trackIndex: 0, fxIndex: 1, inputs: [{ pin: 2, channels: [3] }] });
    expect(json(res)).toEqual({ trackChannels: 4, trackChannelsBefore: 2, inputs: [] });

    sendCommandMock.mockResolvedValueOnce(fail('inputs pin 5 out of range (the FX has 4 inputs pins) — nothing changed'));
    const refused = await tool('set_fx_pins')({ trackIndex: 0, fxIndex: 1, inputs: [{ pin: 5, channels: [3] }] });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toBe('Error: inputs pin 5 out of range (the FX has 4 inputs pins) — nothing changed');
  });

  it('reports a freeze the bridge refused, naming the track', async () => {
    sendCommandMock.mockResolvedValueOnce(fail('Not frozen: Pad — nothing changed'));
    const res = await tool('unfreeze_tracks')({ tracks: ['Pad'] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Not frozen: Pad');
  });
});

describe('quantize_audio', () => {
  const ITEM = { isMidi: false, sourceFile: '/audio/drums.wav', startOffset: 1, playRate: 1, length: 4 };

  it('detects hits in the item\'s source window, drops weak ones, and returns the bridge\'s quantize with the counts', async () => {
    const sc = sidecar([{ time: 1.52, strength: 0.9 }, { time: 2.03, strength: 0.1 }, { time: 2.47, strength: 0.6 }]);
    let sentHits: number[] = [];
    sendCommandMock.mockImplementation(async (type, params) => {
      if (type === 'get_media_item_properties') return ok(ITEM);
      sentHits = JSON.parse(String((params as { hits: string }).hits));
      return ok({ placed: 2, moved: 2, skipped: 0, offsetBefore: { avgMs: 25, maxMs: 30 }, offsetAfter: { avgMs: 0, maxMs: 0 } });
    });
    const res = await tool('quantize_audio')({ trackIndex: 0, itemIndex: 0, grid: 0.5, minStrength: 0.2 });
    expect(res.isError).toBeUndefined();
    expect(sc.transients).toHaveBeenCalledWith(expect.objectContaining({ path: '/audio/drums.wav', startTime: 1, endTime: 5 }));
    expect(sentHits).toEqual([1.52, 2.47]);
    expect(json(res)).toMatchObject({ placed: 2, moved: 2, detected: 3, used: 2, offsetAfter: { avgMs: 0 } });
  });

  it('refuses before touching REAPER when no hit is strong enough, saying how to find more', async () => {
    sidecar([{ time: 1.52, strength: 0.1 }]);
    sendCommandMock.mockResolvedValueOnce(ok(ITEM));
    const res = await tool('quantize_audio')({ trackIndex: 0, itemIndex: 0, grid: 1, minStrength: 0.5 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('No hits to quantize (1 detected');
    expect(res.content[0].text).toContain('Lower minStrength');
  });

  it('refuses a MIDI item and says to use quantize_midi', async () => {
    sidecar([]);
    sendCommandMock.mockResolvedValueOnce(ok({ ...ITEM, isMidi: true }));
    const res = await tool('quantize_audio')({ trackIndex: 0, itemIndex: 0, grid: 1 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('quantize_midi');
  });

  it('says how to install the sidecar when it is missing, before touching REAPER', async () => {
    sidecar([], false);
    const res = await tool('quantize_audio')({ trackIndex: 0, itemIndex: 0, grid: 1 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('setup-sidecar');
  });

  it('reports a failed detection as an error', async () => {
    sidecar(new Error('could not read /audio/drums.wav'));
    sendCommandMock.mockResolvedValueOnce(ok(ITEM));
    const res = await tool('quantize_audio')({ trackIndex: 0, itemIndex: 0, grid: 1 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('Error: Hit detection failed: could not read /audio/drums.wav');
  });
});

describe('mixing tools: input schemas', () => {
  function schema(n: string): z.ZodObject {
    let shape: z.ZodRawShape = {};
    registerMixingTools({ tool: (t: string, _d: string, s: z.ZodRawShape) => { if (t === n) shape = s; } } as unknown as McpServer);
    return z.object(shape);
  }

  it('turns a parameter link off without naming its source, but needs the source to turn it on', () => {
    const s = schema('set_fx_param_modulation');
    expect(s.safeParse({ trackIndex: 0, fxIndex: 0, paramIndex: 1, link: { enabled: false } }).success).toBe(true);
    expect(s.safeParse({ trackIndex: 0, fxIndex: 0, paramIndex: 1, link: { fxIndex: 1, paramIndex: 2 } }).success).toBe(true);
  });

  it('caps quantize_audio swing at 0.9, like quantize_midi', () => {
    const s = schema('quantize_audio');
    expect(s.safeParse({ trackIndex: 0, itemIndex: 0, grid: 0.5, swing: 0.9 }).success).toBe(true);
    expect(s.safeParse({ trackIndex: 0, itemIndex: 0, grid: 0.5, swing: 0.95 }).success).toBe(false);
  });
});
