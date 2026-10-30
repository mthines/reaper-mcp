/**
 * What the mix-check tools report to OpenTelemetry: separate_stems' speed on
 * `reaper.audio.separation.speed` (by device and model) and the masking / stereo /
 * loudness attributes on their spans, observed through in-memory exporters with the
 * bridge and sidecar stubbed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { metrics as otelMetrics } from '@opentelemetry/api';
import { metrics, node, tracing } from '@opentelemetry/sdk-node';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../bridge.js', async (importOriginal) => ({ ...(await importOriginal<object>()), sendCommand: vi.fn() }));
vi.mock('../sidecar.js', () => ({ getSidecarClient: vi.fn() }));
vi.mock('node:fs/promises', () => ({ unlink: vi.fn(async () => undefined) }));

import { sendCommand } from '../bridge.js';
import { getSidecarClient } from '../sidecar.js';
import { instrumentToolHandlers } from '../server.js';
import { registerMixcheckTools } from './mixcheck.js';

const spans = new tracing.InMemorySpanExporter();
const metricExporter = new metrics.InMemoryMetricExporter(metrics.AggregationTemporality.DELTA);
const reader = new metrics.PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{ isError?: boolean }>;

function tools(): Record<string, Handler> {
  const registered: Record<string, Handler> = {};
  const server = { tool: (...args: unknown[]) => { registered[args[0] as string] = args[args.length - 1] as Handler; } };
  instrumentToolHandlers(server as unknown as McpServer);
  registerMixcheckTools(server as unknown as McpServer);
  return registered;
}

async function speeds(): Promise<[number, Record<string, unknown>][]> {
  await reader.forceFlush();
  const out: [number, Record<string, unknown>][] = [];
  for (const rm of metricExporter.getMetrics()) {
    for (const sm of rm.scopeMetrics) {
      for (const m of sm.metrics) {
        if (m.descriptor.name !== 'reaper.audio.separation.speed') continue;
        for (const dp of m.dataPoints) out.push([(dp.value as { sum: number }).sum, dp.attributes]);
      }
    }
  }
  metricExporter.reset();
  return out;
}

const toolSpan = (name: string) => spans.getFinishedSpans().find((s) => s.attributes['gen_ai.tool.name'] === name);

describe('mix-check telemetry', () => {
  beforeAll(() => {
    new node.NodeTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(spans)] }).register();
    otelMetrics.setGlobalMeterProvider(new metrics.MeterProvider({ readers: [reader] }));
  });

  beforeEach(async () => {
    spans.reset();
    await speeds();
    vi.mocked(sendCommand).mockImplementation(async (type) => ({
      id: 't', success: true, timestamp: 0,
      data: type === 'render_track_to_wav' ? { trackName: 'Mix', wavPath: '/tmp/r.wav' } : { path: '/p' },
    }));
    vi.mocked(getSidecarClient).mockReturnValue({
      isAvailable: () => true,
      separate: async () => ({ model: 'htdemucs', device: 'mps', seconds: 20, processingSeconds: 8, stems: [{ stem: 'drums', path: '/o/drums.wav' }] }),
      masking: async () => ({ bandsHz: [100], tracks: ['A', 'B'], pairs: [], conflicts: [{ a: 'A', b: 'B', hz: 100, score: 0.9 }] }),
      stereoBands: async () => ({ bands: [], flags: ['low end wide'] }),
      loudnessCurve: async () => ({ overTargetSeconds: 12.5 }),
    } as unknown as ReturnType<typeof getSidecarClient>);
  });

  it('records how many seconds of audio a separation split per second, by device and model', async () => {
    await tools()['separate_stems']({ trackIndex: 0, endTime: 20, outDir: '/o' }, {});
    const points = await speeds();
    expect(points).toHaveLength(1);
    expect(points[0][0]).toBeCloseTo(2.5);
    expect(points[0][1]).toMatchObject({ 'reaper.separation.device': 'mps', 'reaper.separation.model': 'htdemucs' });
    expect(toolSpan('separate_stems')?.attributes['reaper.separation.stem_count']).toBe(1);
  });

  it('records no speed when the separation fails', async () => {
    vi.mocked(getSidecarClient).mockReturnValue({
      isAvailable: () => true,
      separate: async () => { throw new Error('Stem separation is not installed'); },
    } as unknown as ReturnType<typeof getSidecarClient>);
    const res = await tools()['separate_stems']({ trackIndex: 0, outDir: '/o' }, {});
    expect(res.isError).toBe(true);
    expect(await speeds()).toEqual([]);
  });

  it('puts the masking track and conflict counts, stereo flags and time over target on the spans', async () => {
    const t = tools();
    await t['measure_masking']({ tracks: [0, 1], startTime: 0 }, {});
    await t['analyze_stereo_bands']({ trackIndex: 0 }, {});
    await t['analyze_loudness_curve']({ trackIndex: -1, targetLufs: -14 }, {});
    expect(toolSpan('measure_masking')?.attributes['reaper.masking.track_count']).toBe(2);
    expect(toolSpan('measure_masking')?.attributes['reaper.masking.conflict_count']).toBe(1);
    expect(toolSpan('analyze_stereo_bands')?.attributes['reaper.stereo.flag_count']).toBe(1);
    expect(toolSpan('analyze_loudness_curve')?.attributes['reaper.loudness.over_target_seconds']).toBe(12.5);
  });
});
