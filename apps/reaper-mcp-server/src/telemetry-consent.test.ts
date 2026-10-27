import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { SpanStatusCode } from '@opentelemetry/api';
import { tracing } from '@opentelemetry/sdk-node';
import {
  AnonymizingSpanExporter,
  firstRunTelemetryNotice,
  readTelemetryConfig,
  resolveTelemetry,
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

describe('firstRunTelemetryNotice', () => {
  async function run(dir: string, answer: string | null) {
    const input = new PassThrough();
    const output = new PassThrough();
    let printed = '';
    output.on('data', (chunk: Buffer) => { printed += chunk.toString(); });
    if (answer !== null) input.end(`${answer}\n`);
    const shown = await firstRunTelemetryNotice({ input, output, interactive: answer !== null }, dir, {}, WITH_TOKEN);
    return { shown, printed };
  }

  it.each([
    ['', 'default'],
    ['y', 'default'],
    ['n', 'off'],
    ['No', 'off'],
  ])('answer %j keeps telemetry %s', async (answer, mode) => {
    const dir = tempDir();
    const { shown, printed } = await run(dir, answer);

    expect(shown).toBe(true);
    expect(printed).toMatch(/on by default/i);
    expect(printed).toMatch(/reaper-mcp telemetry off/);
    expect(resolveTelemetry({}, readTelemetryConfig(dir), WITH_TOKEN).mode).toBe(mode);
  });

  it('shows the notice only once', async () => {
    const dir = tempDir();
    await run(dir, 'n');

    const again = await run(dir, 'y');

    expect(again).toEqual({ shown: false, printed: '' });
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

    const shown = await firstRunTelemetryNotice({ input: new PassThrough(), output, interactive: true }, dir, env, destination);

    expect({ shown, printed }).toEqual({ shown: false, printed: '' });
    expect(readTelemetryConfig(dir).telemetryNoticeShown).toBeUndefined();
  });

  it('treats end of input at the prompt as Enter and still saves the choice', async () => {
    const dir = tempDir();
    const input = new PassThrough();
    input.end();

    const shown = await firstRunTelemetryNotice({ input, output: new PassThrough(), interactive: true }, dir, {}, WITH_TOKEN);

    expect(shown).toBe(true);
    expect(readTelemetryConfig(dir)).toEqual({ telemetry: true, telemetryNoticeShown: true });
  });

  it('without a terminal, shows the notice and leaves telemetry on', async () => {
    const dir = tempDir();
    const { shown, printed } = await run(dir, null);

    expect(shown).toBe(true);
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
});
