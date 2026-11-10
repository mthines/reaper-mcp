import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { SpanStatusCode } from '@opentelemetry/api';
import { tracing } from '@opentelemetry/sdk-node';
import {
  AnonymizingSpanExporter,
  consentReportAllowed,
  confirmOptOutPrompt,
  firstRunTelemetryNotice,
  readTelemetryConfig,
  resolveTelemetry,
  saveTelemetryChoice,
  writeTelemetryConfig,
} from './telemetry-consent.js';

const WITH_TOKEN = { token: 'ingest-only' };
const tempDir = () => mkdtempSync(join(tmpdir(), 'reaper-mcp-consent-'));

describe('resolveTelemetry', () => {
  it.each([
    ['nothing set', {}, {}, 'default'],
    ['opted out with the CLI', {}, { telemetry: false }, 'off'],
    ['REAPER_MCP_TELEMETRY=0', { REAPER_MCP_TELEMETRY: '0' }, {}, 'off'],
    ['REAPER_MCP_TELEMETRY=false', { REAPER_MCP_TELEMETRY: 'false' }, {}, 'off'],
    ['DO_NOT_TRACK=1', { DO_NOT_TRACK: '1' }, {}, 'off'],
    ['DO_NOT_TRACK beats an explicit opt-in', { DO_NOT_TRACK: '1', REAPER_MCP_TELEMETRY: '1' }, {}, 'off'],
    ['the env var re-enables a CLI opt-out', { REAPER_MCP_TELEMETRY: '1' }, { telemetry: false }, 'default'],
    ['own OTEL exporters win over everything', { OTEL_TRACES_EXPORTER: 'otlp', DO_NOT_TRACK: '1' }, { telemetry: false }, 'custom'],
    ['OTEL exporters set to none are not custom', { OTEL_TRACES_EXPORTER: 'none' }, {}, 'default'],
  ] as const)('%s', (_label, env, config, mode) => {
    expect(resolveTelemetry(env, config, WITH_TOKEN).mode).toBe(mode);
  });

  it('is off when the build has no destination, and says why', () => {
    const decision = resolveTelemetry({}, {}, { token: '' });
    expect(decision.mode).toBe('off');
    expect(decision.reason).toMatch(/no built-in/);
  });
});

describe('telemetry config', () => {
  it('remembers an opt-out across reads and keeps unrelated settings', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ other: 'kept' }));

    writeTelemetryConfig({ telemetry: false }, dir);

    expect(resolveTelemetry({}, readTelemetryConfig(dir), WITH_TOKEN).mode).toBe('off');
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8'))).toMatchObject({ other: 'kept' });
  });

  it('treats a missing or broken config as no choice made', () => {
    const dir = tempDir();
    expect(readTelemetryConfig(dir)).toEqual({});
    writeFileSync(join(dir, 'config.json'), '{not json');
    expect(readTelemetryConfig(dir)).toEqual({});
  });
});

describe('saveTelemetryChoice', () => {
  it('reports an opt-out once, however often `telemetry off` runs', () => {
    const dir = tempDir();

    expect(saveTelemetryChoice(false, dir)).toEqual({ state: 'off', source: 'cli' });
    expect(saveTelemetryChoice(false, dir)).toBeUndefined();
    expect(resolveTelemetry({}, readTelemetryConfig(dir), WITH_TOKEN).mode).toBe('off');
  });

  it('reports opting back in after an opt-out', () => {
    const dir = tempDir();
    saveTelemetryChoice(false, dir);

    expect(saveTelemetryChoice(true, dir)).toEqual({ state: 'on', source: 'cli' });
    expect(resolveTelemetry({}, readTelemetryConfig(dir), WITH_TOKEN).mode).toBe('default');
  });

  it('reports nothing for `telemetry on` on an install that never opted out', () => {
    expect(saveTelemetryChoice(true, tempDir())).toBeUndefined();
  });
});

describe('consentReportAllowed', () => {
  it.each([
    ['nothing set', {}, WITH_TOKEN, true],
    ['REAPER_MCP_TELEMETRY=1', { REAPER_MCP_TELEMETRY: '1' }, WITH_TOKEN, true],
    ['DO_NOT_TRACK=1', { DO_NOT_TRACK: '1' }, WITH_TOKEN, false],
    ['REAPER_MCP_TELEMETRY=0', { REAPER_MCP_TELEMETRY: '0' }, WITH_TOKEN, false],
    ['own OTEL exporters', { OTEL_TRACES_EXPORTER: 'otlp' }, WITH_TOKEN, false],
    ['no built-in destination', {}, { token: '' }, false],
  ] as const)('%s → %s', (_label, env, destination, allowed) => {
    expect(consentReportAllowed(env, destination)).toBe(allowed);
  });
});

describe('firstRunTelemetryNotice', () => {
  async function run(dir: string, answer: string | null) {
    const input = new PassThrough();
    const output = new PassThrough();
    let printed = '';
    output.on('data', (chunk: Buffer) => { printed += chunk.toString(); });
    if (answer !== null) input.end(`${answer}\n`);
    const choice = await firstRunTelemetryNotice({ input, output, interactive: answer !== null }, dir, {}, WITH_TOKEN);
    return { choice, printed };
  }

  it.each([
    ['', 'default', 'on'],
    ['y', 'default', 'on'],
    ['n\ny', 'off', 'off'],
    ['No\nyes', 'off', 'off'],
  ])('answer %j keeps telemetry %s and returns it as the choice to report', async (answer, mode, state) => {
    const dir = tempDir();
    const { choice, printed } = await run(dir, answer);

    expect(choice).toEqual({ state, source: 'first_run_prompt' });
    expect(printed).toMatch(/on by default/i);
    expect(printed).toMatch(/reaper-mcp telemetry off/);
    expect(printed).toMatch(/answer below is counted once, anonymously/i);
    expect(resolveTelemetry({}, readTelemetryConfig(dir), WITH_TOKEN).mode).toBe(mode);
  });

  it.each(['n\n', 'n\nn', 'n\nno', 'n\n\n'])('asks once more before turning it off, and %j keeps it on', async (answer) => {
    const dir = tempDir();
    const { choice, printed } = await run(dir, answer);

    expect(printed).toMatch(/Totally your call/);
    expect(printed).toMatch(/I can't see your music, projects, track names or files/);
    expect(printed).toMatch(/Turn telemetry off anyway\?/);
    expect(choice).toEqual({ state: 'on', source: 'first_run_prompt' });
    expect(resolveTelemetry({}, readTelemetryConfig(dir), WITH_TOKEN).mode).toBe('default');
  });

  it('does not ask twice when someone keeps it on from the start', async () => {
    const { printed } = await run(tempDir(), 'y');
    expect(printed).not.toMatch(/Totally your call/);
  });

  it('shows the notice only once', async () => {
    const dir = tempDir();
    await run(dir, 'n\ny');

    const again = await run(dir, 'y');

    expect(again).toEqual({ choice: undefined, printed: '' });
    expect(resolveTelemetry({}, readTelemetryConfig(dir), WITH_TOKEN).mode).toBe('off');
  });

  it.each([
    ['DO_NOT_TRACK is set', { DO_NOT_TRACK: '1' }, WITH_TOKEN],
    ['the user has their own OTEL exporters', { OTEL_TRACES_EXPORTER: 'otlp' }, WITH_TOKEN],
    ['the build has no destination', {}, { token: '' }],
  ])('stays silent (and unshown for later) when %s', async (_label, env, destination) => {
    const dir = tempDir();
    const output = new PassThrough();
    let printed = '';
    output.on('data', (chunk: Buffer) => { printed += chunk.toString(); });

    const choice = await firstRunTelemetryNotice({ input: new PassThrough(), output, interactive: true }, dir, env, destination);

    expect({ choice, printed }).toEqual({ choice: undefined, printed: '' });
    expect(readTelemetryConfig(dir).telemetryNoticeShown).toBeUndefined();
  });

  it('treats end of input at the prompt as Enter and still saves the choice', async () => {
    const dir = tempDir();
    const input = new PassThrough();
    input.end();

    const choice = await firstRunTelemetryNotice({ input, output: new PassThrough(), interactive: true }, dir, {}, WITH_TOKEN);

    expect(choice).toEqual({ state: 'on', source: 'first_run_prompt' });
    expect(readTelemetryConfig(dir)).toEqual({ telemetry: true, telemetryNoticeShown: true });
  });

  it('without a terminal, shows the notice and leaves telemetry on', async () => {
    const dir = tempDir();
    const { choice, printed } = await run(dir, null);

    expect(choice).toEqual({ state: 'on', source: 'first_run_notice' });
    expect(printed).toMatch(/on by default/i);
    expect(resolveTelemetry({}, readTelemetryConfig(dir), WITH_TOKEN).mode).toBe('default');
  });
});

describe('AnonymizingSpanExporter', () => {
  it('exports what ran and how it ended, never error text, events or other attributes', async () => {
    const sink = new tracing.InMemorySpanExporter();
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: [new tracing.SimpleSpanProcessor(new AnonymizingSpanExporter(sink))],
    });
    const span = provider.getTracer('test').startSpan('tools/call get_track_properties', {
      attributes: {
        'gen_ai.tool.name': 'get_track_properties',
        'error.type': 'tool_error',
        'reaper.bridge.command.id': 'c3e9a5f7',
        'reaper.track.name': 'Lead Vox',
        'reaper.tool.error.message': 'Error: Track "Lead Vox" not found in ~/Songs/secret.rpp',
      },
    });
    span.recordException(new Error('/Users/someone/Songs/secret.rpp: Track "Lead Vox" not found'));
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Track "Lead Vox" not found' });
    span.end();
    await provider.forceFlush();

    const [exported] = sink.getFinishedSpans();
    expect(exported.name).toBe('tools/call get_track_properties');
    expect(exported.attributes).toEqual({ 'gen_ai.tool.name': 'get_track_properties', 'error.type': 'tool_error' });
    expect(exported.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(exported.events).toEqual([]);
    expect(JSON.stringify(exported.attributes) + JSON.stringify(exported.status)).not.toMatch(/Lead Vox|secret|Users/);
  });

  it('keeps how key and chord detection ran, never the chords', async () => {
    const sink = new tracing.InMemorySpanExporter();
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: [new tracing.SimpleSpanProcessor(new AnonymizingSpanExporter(sink))],
    });
    provider.getTracer('test').startSpan('tools/call detect_chords', {
      attributes: {
        'reaper.chords.source': 'audio',
        'reaper.chords.engine': 'model',
        'reaper.chords.count': 8,
        'reaper.chords.progression': 'C G/B Am7 F',
      },
    }).end();
    await provider.forceFlush();

    expect(sink.getFinishedSpans()[0].attributes).toEqual({
      'reaper.chords.source': 'audio',
      'reaper.chords.engine': 'model',
      'reaper.chords.count': 8,
    });
  });

  it('keeps whether the bridge answered at startup and which setup step is missing', async () => {
    const sink = new tracing.InMemorySpanExporter();
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: [new tracing.SimpleSpanProcessor(new AnonymizingSpanExporter(sink))],
    });
    provider.getTracer('test').startSpan('check bridge connection', {
      attributes: { 'reaper.bridge.connected': false, 'reaper.bridge.state': 'never_started' },
    }).end();
    await provider.forceFlush();

    expect(sink.getFinishedSpans()[0].attributes).toEqual({
      'reaper.bridge.connected': false,
      'reaper.bridge.state': 'never_started',
    });
  });

  it('keeps how a plugin research run went, never which plugin it was', async () => {
    const sink = new tracing.InMemorySpanExporter();
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: [new tracing.SimpleSpanProcessor(new AnonymizingSpanExporter(sink))],
    });
    const run = {
      'reaper.plugin_research.outcome': 'new',
      'reaper.plugin_research.caller': 'learn-plugin',
      'reaper.plugin_research.batch_size': 3,
      'reaper.plugin_research.params_probed': 9,
      'reaper.plugin_research.open_questions': 2,
      'reaper.plugin_research.sources': 3,
      'reaper.plugin_research.cleaned_up': true,
      'reaper.plugin_research.duration_s': 184,
      'reaper.plugin.category': 'compressor',
      'reaper.plugin.style': 'transparent',
      'reaper.plugin.format': 'VST3',
      'reaper.plugin.instrument': false,
      'reaper.plugin.params_total': '16-63',
    };
    provider.getTracer('test').startSpan('tools/call report_plugin_research', {
      attributes: { ...run, 'reaper.plugin.id': 'fabfilter/pro-c-2', 'reaper.fx.name': 'VST3: Pro-C 2 (FabFilter)', 'reaper.plugin_research.scratch_tag': 'PROC2' },
    }).end();
    await provider.forceFlush();

    expect(sink.getFinishedSpans()[0].attributes).toEqual(run);
  });
});

describe('confirmOptOutPrompt (reaper-mcp telemetry off)', () => {
  async function ask(answer: string | null) {
    const input = new PassThrough();
    const output = new PassThrough();
    let printed = '';
    output.on('data', (chunk: Buffer) => { printed += chunk.toString(); });
    if (answer !== null) input.end(`${answer}\n`);
    const off = await confirmOptOutPrompt({ input, output, interactive: answer !== null });
    return { off, printed };
  }

  it('turns it off after a yes, with the reasons it was asked', async () => {
    const { off, printed } = await ask('y');
    expect(off).toBe(true);
    expect(printed).toMatch(/just me: one developer/);
  });

  it.each(['', 'n', 'maybe'])('keeps it on for %j, and says thanks', async (answer) => {
    const { off, printed } = await ask(answer);
    expect(off).toBe(false);
    expect(printed).toMatch(/telemetry stays on/);
  });

  it('turns it off without asking when nobody is at the keyboard', async () => {
    expect(await ask(null)).toEqual({ off: true, printed: '' });
  });
});
