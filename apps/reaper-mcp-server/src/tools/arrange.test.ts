import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod/v4';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerArrangeTools } from './arrange.js';
import { runPlanShape } from './plan.js';
import { TOOL_CATEGORIES } from './categories.js';
import { MCP_TOOL_NAMES } from '../cli.js';

const mockedSendCommand = vi.mocked(sendCommand);
type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function captureTools() {
  const tools: Record<string, { schema: Record<string, z.ZodType>; handler: Handler }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, schema: Record<string, z.ZodType>, handler: Handler) => {
      tools[name] = { schema, handler };
    }),
  } as unknown as McpServer;
  registerArrangeTools(mockServer);
  return tools;
}

const ARRANGE = ['copy_media_items', 'insert_time', 'remove_time', 'copy_section', 'process_items'];

function parse(name: string, raw: Record<string, unknown>) {
  return z.object(captureTools()[name].schema).safeParse(raw);
}

async function call(name: string, raw: Record<string, unknown>) {
  const tools = captureTools();
  return tools[name].handler(z.object(tools[name].schema).parse(raw));
}

describe('arrange tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSendCommand.mockResolvedValue({ id: 't', success: true, data: { itemsMoved: 3 }, timestamp: 0 });
  });

  it('arrange tools: registered, allow-listed and categorized', () => {
    expect(Object.keys(captureTools()).sort()).toEqual([...ARRANGE].sort());
    for (const name of ARRANGE) expect(MCP_TOOL_NAMES as readonly string[]).toContain(name);
    expect(TOOL_CATEGORIES.arrange.tools).toEqual(ARRANGE);
  });

  it('arrange tools: return the bridge result to the agent', async () => {
    const res = await call('insert_time', { position: '4', length: 2 });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual({ itemsMoved: 3 });
  });

  it('arrange tools: report a bridge refusal as an error', async () => {
    mockedSendCommand.mockResolvedValue({ id: 't', success: false, error: 'end must be after start — nothing changed', timestamp: 0 });
    const res = await call('remove_time', { start: 4, end: 2 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('nothing changed');
  });

  it('arrange tools: coerce numbers and refuse bad input before the bridge', () => {
    expect(parse('copy_media_items', { items: [{ trackIndex: '0', itemIndex: '2' }], times: '4' }).success).toBe(true);
    expect(parse('copy_media_items', { items: [] }).success).toBe(false);
    expect(parse('copy_media_items', { items: [{ trackIndex: 0, itemIndex: 0 }], times: 65 }).success).toBe(false);
    expect(parse('insert_time', { position: 0, length: 0 }).success).toBe(false);
    expect(parse('process_items', { operation: 'stretch', items: [{ trackIndex: 0, itemIndex: 0 }] }).success).toBe(false);
    expect(parse('process_items', { operation: 'normalize', items: [{ trackIndex: 0, itemIndex: 0 }], target: 3 }).success).toBe(false);
    expect(parse('copy_section', { regionIndex: '1', position: '32', tracks: ['0', 2] }).success).toBe(true);
  });

  it('arrange tools: run_plan accepts copy_items, insert_time and remove_time ops', () => {
    const plan = z.object(runPlanShape);
    expect(plan.safeParse({ ops: [
      { op: 'copy_items', items: [{ trackIndex: 0, itemIndex: 1 }], times: 2 },
      { op: 'insert_time', position: 8, length: '4' },
      { op: 'remove_time', start: 30, end: 32 },
    ] }).success).toBe(true);
    expect(plan.safeParse({ ops: [{ op: 'insert_time', position: 8 }] }).success).toBe(false);
  });
});
