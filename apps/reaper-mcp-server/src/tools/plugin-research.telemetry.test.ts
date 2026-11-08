/**
 * What a plugin research run reports: fixed values and capped counts on the tool's span, the
 * run's length timed from its scratch track, and the same attributes back to the agent as
 * what was sent — observed through an in-memory span exporter, with the bridge stubbed and the
 * saved telemetry choice in a temporary home folder.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { node, tracing } from '@opentelemetry/sdk-node';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../bridge.js', async (importOriginal) => ({ ...(await importOriginal<object>()), sendCommand: vi.fn() }));

import { sendCommand } from '../bridge.js';
import { instrumentToolHandlers } from '../server.js';
import { initTelemetry } from '../telemetry.js';
import { registerStructureTools } from './structure.js';
import { registerPlanTools } from './plan.js';
import { paramsBucket, registerPluginResearchTools } from './plugin-research.js';

const spans = new tracing.InMemorySpanExporter();

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function tools(): Record<string, Handler> {
  const registered: Record<string, Handler> = {};
  const server = { tool: (...args: unknown[]) => { registered[args[0] as string] = args[args.length - 1] as Handler; } };
  instrumentToolHandlers(server as unknown as McpServer);
  registerStructureTools(server as unknown as McpServer);
  registerPlanTools(server as unknown as McpServer);
  registerPluginResearchTools(server as unknown as McpServer);
  return registered;
}

const reportSpan = () => spans.getFinishedSpans().find((s) => s.name === 'tools/call report_plugin_research');

describe('report_plugin_research', () => {
  let home: string;

  beforeAll(() => {
    new node.NodeTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(spans)] }).register();
  });

  beforeEach(() => {
    spans.reset();
    home = mkdtempSync(join(tmpdir(), 'reaper-mcp-home-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    for (const k of ['DO_NOT_TRACK', 'REAPER_MCP_TELEMETRY', 'OTEL_TRACES_EXPORTER', 'OTEL_METRICS_EXPORTER', 'OTEL_LOGS_EXPORTER']) vi.stubEnv(k, '');
    vi.mocked(sendCommand).mockResolvedValue({ id: 't', success: true, data: { index: 7 }, timestamp: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('records the run as fixed values and capped counts, and tells the agent what was sent', async () => {
    const res = await tools()['report_plugin_research']({
      outcome: 'new', category: 'Compressor, multiband', style: 'Transparent', format: 'VST3i:',
      paramsTotal: 40, paramsProbed: 9, openQuestions: 2, sources: 3, cleanedUp: true, caller: 'learn-plugin', batchSize: 3,
    }, { requestId: 1 });

    const expected = {
      'reaper.plugin_research.outcome': 'new',
      'reaper.plugin_research.caller': 'learn-plugin',
      'reaper.plugin_research.batch_size': 3,
      'reaper.plugin_research.params_probed': 9,
      'reaper.plugin_research.open_questions': 2,
      'reaper.plugin_research.sources': 3,
      'reaper.plugin_research.cleaned_up': true,
      'reaper.plugin.category': 'compressor',
      'reaper.plugin.style': 'transparent',
      'reaper.plugin.format': 'VST3',
      'reaper.plugin.instrument': true,
      'reaper.plugin.params_total': '16-63',
    };
    expect(reportSpan()?.attributes).toMatchObject(expected);
    expect(JSON.parse(res.content[0].text)).toEqual({ telemetry: 'default', sent: expected });
  });

  it('caps counts and maps unknown outcomes and callers instead of refusing the report', async () => {
    await tools()['report_plugin_research']({
      outcome: 'overlay', caller: 'some-other-skill', batchSize: 35, paramsProbed: 500, openQuestions: 99, sources: 40,
    }, { requestId: 1 });

    expect(reportSpan()?.attributes).toMatchObject({
      'reaper.plugin_research.outcome': 'refined',
      'reaper.plugin_research.caller': 'other',
      'reaper.plugin_research.batch_size': 20,
      'reaper.plugin_research.params_probed': 64,
      'reaper.plugin_research.open_questions': 20,
      'reaper.plugin_research.sources': 10,
    });
  });

  it('leaves out what the researcher did not give, instead of sending "other"', async () => {
    await tools()['report_plugin_research']({ outcome: 'not_installed', category: '', style: '  ', format: '' }, { requestId: 1 });

    const attributes = reportSpan()?.attributes ?? {};
    for (const key of ['reaper.plugin.category', 'reaper.plugin.style', 'reaper.plugin.format', 'reaper.plugin.instrument', 'reaper.plugin.params_total', 'reaper.plugin_research.cleaned_up']) {
      expect(attributes).not.toHaveProperty(key);
    }
    expect(attributes).toMatchObject({ 'reaper.plugin_research.outcome': 'not_installed' });
  });

  it('turns free text into "other" and puts no plugin name or tag on the span', async () => {
    await tools()['report_plugin_research']({
      outcome: 'refined', category: 'my bus glue thing', style: 'Pro-Q 4 (FabFilter) [R2R]', format: 'Waves Shell', scratchTag: 'PROQ4',
    }, { requestId: 1 });

    const attributes = reportSpan()?.attributes;
    expect(attributes).toMatchObject({ 'reaper.plugin.category': 'other', 'reaper.plugin.style': 'other', 'reaper.plugin.format': 'other' });
    expect(JSON.stringify(attributes)).not.toMatch(/Pro-Q|PROQ4|R2R|bus glue|Waves/);
  });

  it('times the run from the scratch track add_track created to the report', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
    const registered = tools();
    await registered['add_track']({ name: '[MCP] plugin-research PROC2' }, { requestId: 1 });

    vi.setSystemTime(new Date('2026-11-08T10:03:04Z'));
    await registered['report_plugin_research']({ outcome: 'new', scratchTag: 'PROC2' }, { requestId: 2 });

    expect(reportSpan()?.attributes['reaper.plugin_research.duration_s']).toBe(184);
  });

  it('times a reused tag from its latest scratch track, not from a run that never reported', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T09:00:00Z'));
    const registered = tools();
    await registered['add_track']({ name: '[MCP] plugin-research REAEQ' }, { requestId: 1 }); // this run never reports

    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
    await registered['add_track']({ name: '[MCP] plugin-research REAEQ' }, { requestId: 2 });
    vi.setSystemTime(new Date('2026-11-08T10:00:45Z'));
    await registered['report_plugin_research']({ outcome: 'new', scratchTag: 'REAEQ' }, { requestId: 3 });

    expect(reportSpan()?.attributes['reaper.plugin_research.duration_s']).toBe(45);
  });

  it('times a run whose scratch track run_plan created, and leaves out a run it never saw start', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
    const registered = tools();
    await registered['run_plan']({ ops: [{ op: 'add_track', name: '[MCP] plugin-research VITAL', as: '$t' }] }, { requestId: 1 });

    vi.setSystemTime(new Date('2026-11-08T10:01:30Z'));
    await registered['report_plugin_research']({ outcome: 'new', scratchTag: 'VITAL' }, { requestId: 2 });
    expect(reportSpan()?.attributes['reaper.plugin_research.duration_s']).toBe(90);

    spans.reset();
    await registered['report_plugin_research']({ outcome: 'new', scratchTag: 'NEVERSEEN' }, { requestId: 3 });
    expect(reportSpan()?.attributes).not.toHaveProperty('reaper.plugin_research.duration_s');
  });

  it('starts no timer for a scratch track that failed to add or was only a run_plan dry run', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
    const registered = tools();
    vi.mocked(sendCommand).mockResolvedValueOnce({ id: 't', success: false, error: 'REAPER is busy', timestamp: 0 });
    await registered['add_track']({ name: '[MCP] plugin-research FAILED' }, { requestId: 1 });
    await registered['run_plan']({ ops: [{ op: 'add_track', name: '[MCP] plugin-research DRYRUN' }], dryRun: true }, { requestId: 2 });

    vi.setSystemTime(new Date('2026-11-08T10:02:00Z'));
    await registered['report_plugin_research']({ outcome: 'load_failed', scratchTag: 'FAILED' }, { requestId: 3 });
    await registered['report_plugin_research']({ outcome: 'new', scratchTag: 'DRYRUN' }, { requestId: 4 });

    const reports = spans.getFinishedSpans().filter((s) => s.name === 'tools/call report_plugin_research');
    expect(reports).toHaveLength(2);
    for (const span of reports) expect(span.attributes).not.toHaveProperty('reaper.plugin_research.duration_s');
  });

  it('treats a blank or null parameter count as not known, and reads a numeric string', async () => {
    const registered = tools();
    for (const paramsTotal of ['', '  ', null, 'many', -3]) {
      spans.reset();
      await registered['report_plugin_research']({ outcome: 'not_installed', paramsTotal }, { requestId: 1 });
      expect(reportSpan()?.attributes).not.toHaveProperty('reaper.plugin.params_total');
    }
    spans.reset();
    await registered['report_plugin_research']({ outcome: 'new', paramsTotal: '40' }, { requestId: 2 });
    expect(reportSpan()?.attributes['reaper.plugin.params_total']).toBe('16-63');
  });

  it('sends the parameter count only as a range, with the edges where they belong', () => {
    expect([0, 1, 15, 16, 63, 64, 255, 256, 2048].map(paramsBucket)).toEqual(
      ['none', '1-15', '1-15', '16-63', '16-63', '64-255', '64-255', '256+', '256+'],
    );
    expect(paramsBucket(undefined)).toBeUndefined();
  });

  it('does not time a run that reports more than two hours after its scratch track appeared', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T08:00:00Z'));
    const registered = tools();
    await registered['add_track']({ name: '[MCP] plugin-research STALE' }, { requestId: 1 });

    vi.setSystemTime(new Date('2026-11-08T10:00:01Z'));
    await registered['report_plugin_research']({ outcome: 'new', scratchTag: 'STALE' }, { requestId: 2 });

    expect(reportSpan()?.attributes).not.toHaveProperty('reaper.plugin_research.duration_s');
  });

  it('keeps the 50 newest open runs and forgets the oldest', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
    const registered = tools();
    for (let i = 0; i <= 50; i++) {
      await registered['add_track']({ name: `[MCP] plugin-research RUN${i}` }, { requestId: i });
    }

    vi.setSystemTime(new Date('2026-11-08T10:00:30Z'));
    await registered['report_plugin_research']({ outcome: 'new', scratchTag: 'RUN0' }, { requestId: 100 });
    expect(reportSpan()?.attributes).not.toHaveProperty('reaper.plugin_research.duration_s');

    spans.reset();
    await registered['report_plugin_research']({ outcome: 'new', scratchTag: 'RUN50' }, { requestId: 101 });
    expect(reportSpan()?.attributes['reaper.plugin_research.duration_s']).toBe(30);
  });

  // Last: initTelemetry() fixes the mode for the rest of this file's process.
  it('reports the mode the server started in, not a choice saved after it started', async () => {
    vi.stubEnv('DO_NOT_TRACK', '1');
    await initTelemetry(); // off: returns before any SDK starts
    vi.stubEnv('DO_NOT_TRACK', '');

    const res = await tools()['report_plugin_research']({ outcome: 'not_installed' }, { requestId: 1 });

    expect(JSON.parse(res.content[0].text)).toEqual({ telemetry: 'off', sent: {} });
  });
});
