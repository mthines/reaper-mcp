/**
 * What sendCommand reports to OpenTelemetry, observed end to end: a real temp
 * bridge directory, a tiny fake bridge answering command files, and in-memory
 * span/metric exporters. Internal `_` commands (the diagnostics poller) must
 * stay out of usage telemetry, the way the bridge status page hides them.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { metrics as otelMetrics, trace } from '@opentelemetry/api';
import { metrics, tracing } from '@opentelemetry/sdk-node';
import type { CommandType } from '@reaper-mcp/protocol';
import { sendCommand, pollBridgeDiagnostics } from './bridge.js';

const spans = new tracing.InMemorySpanExporter();
const metricExporter = new metrics.InMemoryMetricExporter(metrics.AggregationTemporality.CUMULATIVE);
const reader = new metrics.PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });

let root: string;
let bridgeDir: string;
let responder: ReturnType<typeof setInterval>;
let received: string[];

/** Answer every command file like the Lua bridge does, recording its type. */
function startFakeBridge(): void {
  responder = setInterval(async () => {
    for (const file of await readdir(bridgeDir).catch(() => [] as string[])) {
      if (!file.startsWith('command_')) continue;
      const path = join(bridgeDir, file);
      const cmd = JSON.parse(await readFile(path, 'utf8').catch(() => 'null')) as { id: string; type: string } | null;
      if (!cmd) continue;
      await rm(path, { force: true });
      received.push(cmd.type);
      const data = cmd.type === '_bridge_diagnostics'
        ? { deferIntervals: { p50Ms: 30, p95Ms: 33 }, scanDurations: { avgMs: 0.1, maxMs: 0.4 } }
        : {};
      await writeFile(join(bridgeDir, `response_${cmd.id}.json`), JSON.stringify({ id: cmd.id, success: true, data, _handlerMs: 0.2, _pickupMs: 3 }));
    }
  }, 2);
}

/** rpc.method values recorded on the per-command duration metrics. */
async function meteredMethods(): Promise<string[]> {
  await reader.forceFlush();
  const methods = new Set<string>();
  for (const rm of metricExporter.getMetrics()) {
    for (const sm of rm.scopeMetrics) {
      for (const m of sm.metrics) {
        if (!m.descriptor.name.startsWith('reaper.bridge.')) continue;
        for (const dp of m.dataPoints) {
          const method = dp.attributes['rpc.method'];
          if (typeof method === 'string') methods.add(method);
        }
      }
    }
  }
  return [...methods];
}

describe('bridge telemetry', () => {
  beforeAll(() => {
    trace.setGlobalTracerProvider(
      new tracing.BasicTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(spans)] }),
    );
    otelMetrics.setGlobalMeterProvider(new metrics.MeterProvider({ readers: [reader] }));
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'reaper-mcp-telemetry-'));
    bridgeDir = join(root, 'Scripts', 'mcp_bridge_data');
    await mkdir(bridgeDir, { recursive: true });
    await writeFile(join(bridgeDir, 'heartbeat.json'), '{}');
    process.env['REAPER_RESOURCE_PATH'] = root;
    received = [];
    spans.reset();
    startFakeBridge();
  });

  afterEach(async () => {
    clearInterval(responder);
    delete process.env['REAPER_RESOURCE_PATH'];
    await rm(root, { recursive: true, force: true });
  });

  it('traces and meters a tool command', async () => {
    const res = await sendCommand('get_project_info');

    expect(res.success).toBe(true);
    expect(spans.getFinishedSpans().map((s) => s.name)).toEqual(['reaper.Bridge/get_project_info']);
    expect(await meteredMethods()).toContain('get_project_info');
  });

  it('keeps the diagnostics poll out of traces and per-command metrics, but still polls', async () => {
    await pollBridgeDiagnostics();

    expect(received).toEqual(['_bridge_diagnostics']);
    expect(spans.getFinishedSpans()).toEqual([]);
    expect(await meteredMethods()).not.toContain('_bridge_diagnostics');
  });

  it('keeps any internal command out of traces', async () => {
    const res = await sendCommand('_session' as CommandType);

    expect(res.success).toBe(true);
    expect(spans.getFinishedSpans()).toEqual([]);
  });
});
