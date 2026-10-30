import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod/v4';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MAX_COMP_RANGES, registerRecordingTools } from './recording.js';

const mockedSendCommand = vi.mocked(sendCommand);

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function captureTools() {
  const tools: Record<string, { schema: z.ZodObject; handler: Handler }> = {};
  const mockServer = {
    tool: (name: string, _desc: string, schema: z.ZodRawShape, handler: Handler) => {
      tools[name] = { schema: z.object(schema), handler };
    },
  } as unknown as McpServer;
  registerRecordingTools(mockServer);
  return tools;
}

const ok = (data: unknown) => ({ id: 'test', success: true, data, timestamp: Date.now() });

describe('recording tools', () => {
  let tools: ReturnType<typeof captureTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  it('get_record_setup returns the bridge answer to the agent', async () => {
    const setup = { mode: 'normal', recordPath: 'media', armedCount: 1, tracks: [{ name: 'Vox', input: { label: 'In 3/4' } }] };
    mockedSendCommand.mockResolvedValue(ok(setup));
    const res = await tools['get_record_setup'].handler({});
    expect(JSON.parse(res.content[0].text)).toEqual(setup);
  });

  it('passes a bridge refusal through as an error', async () => {
    mockedSendCommand.mockResolvedValue({ id: 't', success: false, error: 'tracks[1]: input 2/3 does not exist — nothing changed', timestamp: 0 });
    const res = await tools['set_track_record'].handler({ tracks: [{ track: 'Vox', arm: true }] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('Error: tracks[1]: input 2/3 does not exist — nothing changed');
  });

  it('accepts audio, MIDI and no-input record inputs, and refuses malformed ones before the bridge', () => {
    const schema = tools['set_track_record'].schema;
    expect(schema.safeParse({ tracks: [
      { track: 'Vox', arm: true, input: { kind: 'audio', channel: '3', stereo: true }, monitor: 'auto' },
      { track: 2, input: { kind: 'midi', device: 'all', channel: 0 }, mode: 'midi_overdub' },
      { track: 'Gtr', input: { kind: 'none' } },
    ] }).success).toBe(true);
    expect(schema.safeParse({ tracks: [{ track: 'Vox', input: { kind: 'audio', channel: 0 } }] }).success).toBe(false);
    expect(schema.safeParse({ tracks: [{ track: 'Vox', input: { kind: 'midi', channel: 17 } }] }).success).toBe(false);
    expect(schema.safeParse({ tracks: [{ track: 'Vox', monitor: 'tape' }] }).success).toBe(false);
    expect(schema.safeParse({ tracks: [] }).success).toBe(false);
  });

  it('set_track_lanes takes one lane to play alone or several to layer', () => {
    const schema = tools['set_track_lanes'].schema;
    expect(schema.safeParse({ track: 'Vox', play: 2 }).success).toBe(true);
    expect(schema.safeParse({ track: 'Vox', play: [0, 2] }).success).toBe(true);
    expect(schema.safeParse({ track: 'Vox', play: [] }).success).toBe(false);
    expect(schema.safeParse({ track: 'Vox', laneCount: 65 }).success).toBe(false);
  });

  it('comp_lanes caps the ranges per call and returns the comp', async () => {
    const schema = tools['comp_lanes'].schema;
    const range = { start: 0, end: 1, lane: 0 };
    expect(schema.safeParse({ track: 'Vox', ranges: Array(MAX_COMP_RANGES).fill(range) }).success).toBe(true);
    expect(schema.safeParse({ track: 'Vox', ranges: Array(MAX_COMP_RANGES + 1).fill(range) }).success).toBe(false);
    expect(schema.safeParse({ track: 'Vox', ranges: [range], crossfadeMs: 600 }).success).toBe(false);

    const comp = { compLane: 3, laneCount: 4, segments: [{ start: 10, end: 13, lane: 0, crossfadeMs: 10 }, { start: 13, end: 20, lane: 1, crossfadeMs: 0 }] };
    mockedSendCommand.mockResolvedValue(ok(comp));
    const res = await tools['comp_lanes'].handler({ track: 'Vox', ranges: [{ start: 10, end: 13, lane: 0 }, { start: 13, end: 20, lane: 1 }] });
    expect(JSON.parse(res.content[0].text)).toEqual(comp);
  });
});
