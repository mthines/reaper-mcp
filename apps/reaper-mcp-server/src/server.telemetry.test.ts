import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { homedir } from 'node:os';
import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { tracing } from '@opentelemetry/sdk-node';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { instrumentToolHandlers } from './server.js';
import { noteLoggedFailure } from './call-outcome.js';

const exporter = new tracing.InMemorySpanExporter();

/** The `reaper.tool.failed` log lines the wrapper wrote to stderr in this test. */
function toolFailedLogs(): Record<string, unknown>[] {
  return vi.mocked(console.error).mock.calls
    .map((call) => { try { return JSON.parse(String(call[0])) as Record<string, unknown>; } catch { return {}; } })
    .filter((line) => line['event'] === 'reaper.tool.failed');
}

type ToolCb = (...args: unknown[]) => Promise<unknown>;

/** Register one tool on a stub server through the instrumentation wrapper; return the wrapped callback. */
function wrapTool(name: string, cb: ToolCb): ToolCb {
  let registered: ToolCb | undefined;
  const server = { tool: (...args: unknown[]) => { registered = args[args.length - 1] as ToolCb; } };
  instrumentToolHandlers(server as unknown as McpServer);
  server.tool(name, 'desc', {}, cb);
  return registered as ToolCb;
}

describe('instrumentToolHandlers', () => {
  beforeAll(() => {
    trace.setGlobalTracerProvider(
      new tracing.BasicTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(exporter)] }),
    );
  });

  beforeEach(() => {
    exporter.reset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined).mockClear();
  });

  it('emits a SERVER span following the MCP semantic conventions', async () => {
    const cb = wrapTool('list_tracks', async () => ({ content: [{ type: 'text', text: '[]' }] }));

    await cb({}, { requestId: 7 });

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('tools/call list_tracks');
    expect(span.kind).toBe(SpanKind.SERVER);
    expect(span.attributes).toMatchObject({
      'mcp.method.name': 'tools/call',
      'gen_ai.tool.name': 'list_tracks',
      'gen_ai.operation.name': 'execute_tool',
      'jsonrpc.request.id': '7',
      'network.transport': 'pipe',
    });
    expect(span.attributes['error.type']).toBeUndefined();
    expect(span.attributes['reaper.tool.error.message']).toBeUndefined();
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('marks a refused request error.type=tool_error but leaves the status unset, like an HTTP 4xx', async () => {
    const cb = wrapTool('add_fx', async () => ({ content: [{ type: 'text', text: 'Error: no such FX' }], isError: true }));

    await cb({}, { requestId: 1 });

    const [span] = exporter.getFinishedSpans();
    expect(span.attributes['error.type']).toBe('tool_error');
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('keeps a refused request\'s message on the span, since an unset status carries none', async () => {
    const cb = wrapTool('detect_chords', async () => ({
      content: [{ type: 'text', text: 'Give exactly one of trackIndex or path' }],
      isError: true,
    }));

    await cb({}, { requestId: 4 });

    const [span] = exporter.getFinishedSpans();
    expect(span.attributes['reaper.tool.error.message']).toBe('Give exactly one of trackIndex or path');
  });

  it('writes the home directory as ~ and caps a long failure message', async () => {
    const text = `Render failed: no output file at ${homedir()}/Music/${'x'.repeat(400)}.wav`;
    const cb = wrapTool('detect_chords', async () => ({ content: [{ type: 'text', text }], isError: true }));

    await cb({}, { requestId: 5 });

    const message = String(exporter.getFinishedSpans()[0].attributes['reaper.tool.error.message']);
    expect(message.startsWith('Render failed: no output file at ~/Music/')).toBe(true);
    expect(message).not.toContain(homedir());
    expect(message.length).toBeLessThanOrEqual(256);
  });

  it.each([
    'Error: Internal error: emitter was inserted but could not be found',
    'Error: Handler error: attempt to index a nil value',
    'Error: Timeout: no response from REAPER Lua bridge after 10000ms',
  ])('marks a system error as a failed span: %s', async (text) => {
    const cb = wrapTool('send_midi_cc', async () => ({ content: [{ type: 'text', text }], isError: true }));

    await cb({}, { requestId: 1 });

    const [span] = exporter.getFinishedSpans();
    expect(span.attributes['error.type']).toBe('tool_error');
    expect(span.status).toMatchObject({ code: SpanStatusCode.ERROR, message: text });
    expect(span.attributes['reaper.tool.error.message']).toBe(text);
    expect(toolFailedLogs()).toEqual([expect.objectContaining({ level: 'error' })]);
  });

  it('logs nothing of its own for an isError result the bridge already logged', async () => {
    const cb = wrapTool('send_midi_cc', async () => {
      noteLoggedFailure(false); // what sendCommand does after logging a refused request
      return { content: [{ type: 'text', text: 'Error: Track 9 not found' }], isError: true };
    });

    await cb({}, { requestId: 3 });

    expect(toolFailedLogs()).toEqual([]);
  });

  it('logs a failure nothing below logged once, as a warning', async () => {
    const cb = wrapTool('detect_chords', async () => ({
      content: [{ type: 'text', text: 'Give exactly one of trackIndex or path' }],
      isError: true,
    }));

    await cb({}, { requestId: 6 });

    expect(toolFailedLogs()).toEqual([
      expect.objectContaining({ level: 'warn', 'gen_ai.tool.name': 'detect_chords', 'error.type': 'tool_error' }),
    ]);
    expect(exporter.getFinishedSpans()[0].status.code).toBe(SpanStatusCode.UNSET);
  });

  it('marks the span failed when a call below hit a regression, whatever the message says', async () => {
    const cb = wrapTool('analyze_audio_file', async () => {
      noteLoggedFailure(true); // what the sidecar client does after logging a raised analysis
      return { content: [{ type: 'text', text: 'Analysis failed: the sidecar could not read the file' }], isError: true };
    });

    await cb({}, { requestId: 8 });

    const [span] = exporter.getFinishedSpans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(toolFailedLogs()).toEqual([]);
  });

  it('keeps the status unset when the calls below failed as expected', async () => {
    const cb = wrapTool('transform_midi', async () => {
      noteLoggedFailure(false);
      return {
        content: [{ type: 'text', text: "Error: Bridge outdated: the REAPER bridge does not know the command 'transform_midi'" }],
        isError: true,
      };
    });

    await cb({}, { requestId: 9 });

    expect(exporter.getFinishedSpans()[0].status.code).toBe(SpanStatusCode.UNSET);
  });

  it('records the exception class as error.type and rethrows', async () => {
    const cb = wrapTool('play', async () => { throw new TypeError('boom'); });

    await expect(cb({}, { requestId: 2 })).rejects.toThrow('boom');

    const [span] = exporter.getFinishedSpans();
    expect(span.attributes['error.type']).toBe('TypeError');
    expect(span.attributes['reaper.tool.error.message']).toBe('TypeError: boom');
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
  });
});
