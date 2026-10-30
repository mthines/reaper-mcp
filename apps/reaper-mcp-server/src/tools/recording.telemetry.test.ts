/**
 * What the recording tools report to OpenTelemetry: comp sizes on `reaper.comp.segments`
 * and the record / lane / comp attributes on their spans, observed through in-memory
 * exporters with the bridge stubbed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { metrics as otelMetrics } from '@opentelemetry/api';
import { metrics, node, tracing } from '@opentelemetry/sdk-node';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../bridge.js', async (importOriginal) => ({ ...(await importOriginal<object>()), sendCommand: vi.fn() }));

import { sendCommand } from '../bridge.js';
import { instrumentToolHandlers } from '../server.js';
import { registerRecordingTools } from './recording.js';

const spans = new tracing.InMemorySpanExporter();
const metricExporter = new metrics.InMemoryMetricExporter(metrics.AggregationTemporality.DELTA);
const reader = new metrics.PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{ isError?: boolean }>;

function tools(): Record<string, Handler> {
  const registered: Record<string, Handler> = {};
  const server = { tool: (...args: unknown[]) => { registered[args[0] as string] = args[args.length - 1] as Handler; } };
  instrumentToolHandlers(server as unknown as McpServer);
  registerRecordingTools(server as unknown as McpServer);
  return registered;
}

async function compSizes(): Promise<number[]> {
  await reader.forceFlush();
  const out: number[] = [];
  for (const rm of metricExporter.getMetrics()) {
    for (const sm of rm.scopeMetrics) {
      for (const m of sm.metrics) {
        if (m.descriptor.name !== 'reaper.comp.segments') continue;
        for (const dp of m.dataPoints) out.push((dp.value as { sum: number }).sum);
      }
    }
  }
  metricExporter.reset();
  return out;
}

const toolSpan = (name: string) => spans.getFinishedSpans().find((s) => s.attributes['gen_ai.tool.name'] === name);
const ok = (data: unknown) => ({ id: 't', success: true, data, timestamp: 0 });

describe('recording telemetry', () => {
  beforeAll(() => {
    new node.NodeTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(spans)] }).register();
    otelMetrics.setGlobalMeterProvider(new metrics.MeterProvider({ readers: [reader] }));
  });

  beforeEach(async () => {
    spans.reset();
    await compSizes();
    vi.mocked(sendCommand).mockReset();
  });

  it('records the comp size and how many takes it drew from', async () => {
    vi.mocked(sendCommand).mockResolvedValue(ok({
      laneCount: 4, compLane: 3,
      segments: [{ lane: 0 }, { lane: 1 }, { lane: 0 }, { lane: 2 }],
    }));
    await tools()['comp_lanes']({ track: 'Vox', ranges: [{ start: 0, end: 1, lane: 0 }] }, {});
    expect(await compSizes()).toEqual([4]);
    const span = toolSpan('comp_lanes');
    expect(span?.attributes['reaper.comp.segment_count']).toBe(4);
    expect(span?.attributes['reaper.comp.source_lane_count']).toBe(3);
    expect(span?.attributes['reaper.lanes.count']).toBe(4);
  });

  it('records nothing for a refused comp', async () => {
    vi.mocked(sendCommand).mockResolvedValue({ id: 't', success: false, error: 'lane 2 has no audio', timestamp: 0 });
    const res = await tools()['comp_lanes']({ track: 'Vox', ranges: [{ start: 0, end: 1, lane: 2 }] }, {});
    expect(res.isError).toBe(true);
    expect(await compSizes()).toEqual([]);
  });

  it('logs an error when a comp broke half way and was undone, but not for a refusal', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(sendCommand).mockResolvedValueOnce({ id: 't', success: false, error: 'lane 2 has no audio from 1 s to 2 s', timestamp: 0 });
    await tools()['comp_lanes']({ track: 'Vox', ranges: [{ start: 1, end: 2, lane: 2 }] }, {});
    vi.mocked(sendCommand).mockResolvedValueOnce({ id: 't', success: false, error: 'comp failed and was undone: disk full', timestamp: 0 });
    await tools()['comp_lanes']({ track: 'Vox', ranges: [{ start: 1, end: 2, lane: 0 }] }, {});
    const events = errors.mock.calls.map(([line]) => JSON.parse(String(line)) as { level: string; event?: string });
    expect(events.filter((e) => e.event === 'reaper.comp.undone')).toEqual([expect.objectContaining({ level: 'error' })]);
    errors.mockRestore();
  });

  it('tags the record mode and armed count on record setup spans', async () => {
    vi.mocked(sendCommand).mockResolvedValue(ok({ mode: 'time_selection', armedCount: 3, tracks: [] }));
    await tools()['get_record_setup']({}, {});
    const span = toolSpan('get_record_setup');
    expect(span?.attributes['reaper.record.mode']).toBe('time_selection');
    expect(span?.attributes['reaper.record.armed_count']).toBe(3);
  });
});
