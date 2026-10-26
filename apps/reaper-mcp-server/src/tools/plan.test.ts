import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod/v4';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PlanOp } from '@reaper-mcp/protocol';
import { registerPlanTools, runPlanShape, validatePlanRefs, RUN_PLAN_TIMEOUT_MS } from './plan.js';

const mockedSendCommand = vi.mocked(sendCommand);

function captureTools() {
  const tools: Record<string, { handler: (...args: unknown[]) => unknown }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = { handler };
    }),
  } as unknown as McpServer;
  registerPlanTools(mockServer);
  return tools;
}

const ALL_SIX: PlanOp[] = [
  { op: 'add_track', name: 'Drum Bus', as: '$bus' },
  { op: 'set_track', track: '$bus', volume: -6, name: 'Drums' },
  { op: 'add_fx', track: '$bus', fxName: 'ReaComp', params: [{ index: 0, value: 0.4 }], as: '$comp' },
  { op: 'set_fx_params', fx: '$comp', params: [{ index: 1, value: 0.2 }] },
  { op: 'add_send', from: 'Kick', to: '$bus', volume: -3 },
  { op: 'graft_fxchain', track: 'Snare', from: 3 },
];

describe('run_plan tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('plan tool: accepts all six op types', () => {
    const parsed = z.object(runPlanShape).parse({ ops: ALL_SIX });
    expect(parsed.ops.map(o => o.op)).toEqual([
      'add_track', 'set_track', 'add_fx', 'set_fx_params', 'add_send', 'graft_fxchain',
    ]);
    expect(validatePlanRefs(parsed.ops as PlanOp[])).toEqual([]);
  });

  it('plan tool: coerces numeric strings in numeric fields', () => {
    const parsed = z.object(runPlanShape).parse({
      ops: [{ op: 'set_track', track: 'Kick', volume: '-3', mute: '1' }],
    });
    expect(parsed.ops[0]).toMatchObject({ volume: -3, mute: 1 });
  });

  it('plan tool: rejects unknown op types and bad ref names', () => {
    expect(() => z.object(runPlanShape).parse({ ops: [{ op: 'delete_everything' }] })).toThrow();
    expect(() => z.object(runPlanShape).parse({ ops: [{ op: 'add_track', as: 'bus' }] })).toThrow();
    expect(() => z.object(runPlanShape).parse({ ops: [] })).toThrow();
  });

  it('plan tool: rejects ref used before definition', async () => {
    const tools = captureTools();
    const result = await tools['run_plan'].handler({
      ops: [
        { op: 'add_send', from: 'Kick', to: '$bus' },
        { op: 'add_track', name: 'Bus', as: '$bus' },
      ],
    }) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('op 0 (add_send): to $bus is not defined by an earlier op');
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it('plan tool: validatePlanRefs catches kind mismatches, duplicates and graft source', () => {
    expect(validatePlanRefs([
      { op: 'add_fx', track: 'Kick', fxName: 'ReaEQ', as: '$eq' },
      { op: 'set_track', track: '$eq', volume: 0 },
      { op: 'add_track', as: '$eq' },
      { op: 'graft_fxchain', track: 'Kick' },
      { op: 'set_fx_params', fx: 0, params: [{ index: 0, value: 1 }] },
    ])).toEqual([
      'op 1 (set_track): track $eq is an FX, not a track',
      'op 2 (add_track): $eq is already defined',
      'op 3 (graft_fxchain): give exactly one of from or fromChunk',
      'op 4 (set_fx_params): track is required unless fx is a "$ref"',
    ]);
  });

  it('plan tool: applies with extended timeout', async () => {
    mockedSendCommand.mockResolvedValue({ id: 't', success: true, data: { success: true, applied: 6 }, timestamp: 0 });
    const tools = captureTools();
    await tools['run_plan'].handler({ ops: ALL_SIX, idempotencyKey: 'k1' });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    const [type, params, timeout] = mockedSendCommand.mock.calls[0];
    expect(type).toBe('run_plan');
    expect(timeout).toBe(RUN_PLAN_TIMEOUT_MS);
    expect(timeout).toBeGreaterThan(10_000);
    expect(params).toMatchObject({ idempotencyKey: 'k1' });
    expect(JSON.parse((params as { ops: string }).ops)).toEqual(ALL_SIX);
  });

  it('plan tool: dryRun uses the default timeout and passes the flag', async () => {
    mockedSendCommand.mockResolvedValue({ id: 't', success: true, data: { dryRun: true, valid: true }, timestamp: 0 });
    const tools = captureTools();
    await tools['run_plan'].handler({ ops: ALL_SIX, dryRun: true });
    const [, params, timeout] = mockedSendCommand.mock.calls[0];
    expect(timeout).toBeUndefined();
    expect(params).toMatchObject({ dryRun: true });
  });

  it('plan tool: propagates bridge errors', async () => {
    mockedSendCommand.mockResolvedValue({ id: 't', success: false, error: 'op 1 (add_fx) failed', timestamp: 0 });
    const tools = captureTools();
    const result = await tools['run_plan'].handler({ ops: ALL_SIX });
    expect(result).toEqual({ content: [{ type: 'text', text: 'Error: op 1 (add_fx) failed' }], isError: true });
  });
});
