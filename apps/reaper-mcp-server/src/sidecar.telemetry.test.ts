/**
 * What a failed sidecar request does to the tool that made it, end to end: the real tool wrapper and the real
 * sidecar client over a fake Python process. A regression in the sidecar fails the tool's span; input the sidecar
 * rejected leaves it unset. Either way the tool logs nothing of its own, since the sidecar call already did.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { tracing } from '@opentelemetry/sdk-node';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Partial mocks: the tool modules server.ts loads import other functions from these.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn(),
}));
vi.mock('./setup-sidecar.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./setup-sidecar.js')>()),
  copySidecarScript: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getSidecarClient, _resetSidecarClient } from './sidecar.js';
import { instrumentToolHandlers } from './server.js';

const spans = new tracing.InMemorySpanExporter();

type ToolCb = (...args: unknown[]) => Promise<unknown>;

/** Register one tool through the instrumentation wrapper on a stub server; return the wrapped callback. */
function wrapTool(name: string, cb: ToolCb): ToolCb {
  let registered: ToolCb | undefined;
  const server = { tool: (...args: unknown[]) => { registered = args[args.length - 1] as ToolCb; } };
  instrumentToolHandlers(server as unknown as McpServer);
  server.tool(name, 'desc', {}, cb);
  return registered as ToolCb;
}

/** A fake sidecar process that answers the first request with this JSON-RPC error. */
function fakeSidecar(error: { code: number; message: string }): void {
  const proc = Object.assign(new EventEmitter(), {
    stdin: { write: vi.fn(() => {
      setImmediate(() => proc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: 1, error }) + '\n'));
      return true;
    }) },
    stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    killed: false,
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(proc as never);
  vi.mocked(existsSync).mockReturnValue(true);
}

/** A tool that runs one sidecar analysis and passes its failure on to the agent, as the analysis tools do. */
const analyzeTool = (): ToolCb => wrapTool('analyze_track_aesthetics', async () => {
  try {
    await getSidecarClient().analyze('/tmp/clip.wav', 0, 5);
    return { content: [{ type: 'text', text: 'ok' }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

/** Every log line written to stderr in this test (emitLog mirrors each record there as JSON). */
function logLines(): { level?: string; event?: string }[] {
  return vi.mocked(console.error).mock.calls.flatMap((call) => {
    try { return [JSON.parse(String(call[0])) as { level?: string; event?: string }]; } catch { return []; }
  });
}

describe('a sidecar failure under a tool', () => {
  beforeAll(() => {
    trace.setGlobalTracerProvider(
      new tracing.BasicTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(spans)] }),
    );
  });

  beforeEach(() => {
    spans.reset();
    _resetSidecarClient();
    vi.spyOn(console, 'error').mockImplementation(() => undefined).mockClear();
  });

  afterEach(() => {
    _resetSidecarClient();
  });

  it('fails the tool span when the analysis raised, with only the sidecar\'s ERROR log', async () => {
    fakeSidecar({ code: -32000, message: 'Inference failed: CUDA out of memory' });

    await analyzeTool()({}, { requestId: 1 });

    const tool = spans.getFinishedSpans().find((s) => s.name === 'tools/call analyze_track_aesthetics');
    expect(tool?.attributes['error.type']).toBe('tool_error');
    expect(tool?.status.code).toBe(SpanStatusCode.ERROR);
    expect(logLines().map((l) => [l.level, l.event])).toEqual([['error', 'reaper.sidecar.request.failed']]);
  });

  it('keeps the tool span unset when the sidecar rejected the input, with only the sidecar\'s WARN log', async () => {
    fakeSidecar({ code: -32000, message: 'Audio too short: 0.30s (minimum 0.5s)' });

    await analyzeTool()({}, { requestId: 2 });

    const tool = spans.getFinishedSpans().find((s) => s.name === 'tools/call analyze_track_aesthetics');
    expect(tool?.attributes['error.type']).toBe('tool_error');
    expect(tool?.status.code).toBe(SpanStatusCode.UNSET);
    expect(logLines().map((l) => [l.level, l.event])).toEqual([['warn', 'reaper.sidecar.request.failed']]);
  });
});
