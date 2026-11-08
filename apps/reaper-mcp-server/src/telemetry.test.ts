import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpanKind } from '@opentelemetry/api';
import { core, tracing } from '@opentelemetry/sdk-node';
import { CLIENT_CONNECTED_SPAN, readInstallId, recordClientConnected, reportConsentChange } from './telemetry.js';
import { AnonymizingSpanExporter } from './telemetry-consent.js';

describe('readInstallId', () => {
  it('creates an id on first run and returns the same one after', () => {
    const root = mkdtempSync(join(tmpdir(), 'reaper-mcp-'));
    const dir = join(root, 'nested');
    try {
      const first = readInstallId(dir);

      expect(first).toMatch(/^[0-9a-f-]{36}$/);
      expect(readFileSync(join(dir, 'install-id'), 'utf-8').trim()).toBe(first);
      expect(readInstallId(dir)).toBe(first);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns undefined instead of throwing when the dir is unwritable', () => {
    expect(readInstallId('/dev/null/not-a-dir')).toBeUndefined();
  });
});

describe('recordClientConnected', () => {
  it('sends one INTERNAL span that usage telemetry keeps, so a launch with an agent attached can be told apart', () => {
    const memory = new tracing.InMemorySpanExporter();
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: [new tracing.SimpleSpanProcessor(new AnonymizingSpanExporter(memory))],
    });

    recordClientConnected(provider.getTracer('test'));

    const spans = memory.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span.name).toBe(CLIENT_CONNECTED_SPAN);
    // Not SERVER: usage queries count SERVER spans as tool calls
    expect(span.kind).toBe(SpanKind.INTERNAL);
    expect(span.attributes).toEqual({ 'mcp.method.name': 'notifications/initialized' });
  });
});

describe('reportConsentChange', () => {
  const DESTINATION = { endpoint: 'http://127.0.0.1:9', dataset: 'test', token: 'ingest-only' };

  /** Keeps what it was given; shutdown keeps it too (an InMemorySpanExporter would clear it). */
  function recordingExporter() {
    const spans: tracing.ReadableSpan[] = [];
    const exporter: tracing.SpanExporter = {
      export: (batch, done) => {
        spans.push(...batch);
        done({ code: core.ExportResultCode.SUCCESS });
      },
      shutdown: () => Promise.resolve(),
    };
    return { spans, exporter };
  }

  it('sends one anonymous span: on/off and where, never an install id', async () => {
    const { spans, exporter } = recordingExporter();

    const sent = await reportConsentChange({ state: 'off', source: 'cli' }, { env: {}, destination: DESTINATION, exporter });

    expect(sent).toBe(true);
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span.name).toBe('telemetry consent');
    expect(span.attributes).toEqual({ 'reaper.telemetry.consent.state': 'off', 'reaper.telemetry.consent.source': 'cli' });
    const resource = span.resource.attributes;
    expect(resource['service.name']).toBe('reaper-mcp-consent');
    expect(resource['os.type']).toBeTypeOf('string');
    for (const key of ['enduser.pseudo.id', 'service.instance.id', 'process.pid', 'host.name', 'host.id']) {
      expect(resource).not.toHaveProperty(key);
    }
  });

  it.each([
    ['DO_NOT_TRACK=1', { DO_NOT_TRACK: '1' }],
    ['REAPER_MCP_TELEMETRY=0', { REAPER_MCP_TELEMETRY: '0' }],
    ['own OTEL exporters', { OTEL_TRACES_EXPORTER: 'otlp' }],
  ])('sends nothing when %s', async (_label, env) => {
    const { spans, exporter } = recordingExporter();

    const sent = await reportConsentChange({ state: 'off', source: 'first_run_prompt' }, { env, destination: DESTINATION, exporter });

    expect(sent).toBe(false);
    expect(spans).toEqual([]);
  });

  it('delivers it over OTLP to the built-in destination with its ingest token', async () => {
    const received: { url?: string; headers: IncomingHttpHeaders; body: Buffer }[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(200, { 'content-type': 'application/x-protobuf' }).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const sent = await reportConsentChange(
        { state: 'on', source: 'first_run_notice' },
        { env: {}, destination: { ...DESTINATION, endpoint: `http://127.0.0.1:${port}` } },
      );

      expect(sent).toBe(true);
      expect(received).toHaveLength(1);
      const [request] = received;
      expect(request.url).toBe('/v1/traces');
      expect(request.headers.authorization).toBe('Bearer ingest-only');
      expect(request.headers.dataset).toBe('test');
      const body = request.body.toString('latin1');
      expect(body).toContain('reaper-mcp-consent');
      expect(body).toContain('reaper.telemetry.consent.state');
      expect(body).toContain('first_run_notice');
      expect(body).not.toContain('enduser.pseudo.id');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('gives up quietly when the destination is unreachable', async () => {
    const started = Date.now();

    const sent = await reportConsentChange({ state: 'off', source: 'cli' }, { env: {}, destination: DESTINATION, timeoutMs: 500 });

    expect(sent).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
