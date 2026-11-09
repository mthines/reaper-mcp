/**
 * Vitest unit tests for sidecar.ts (Python subprocess lifecycle + JSON-RPC client).
 *
 * Mock strategy: vi.mock('node:child_process') + vi.mock('node:fs')
 * All tests run without a real Python process.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { tracing } from '@opentelemetry/sdk-node';

// ---------------------------------------------------------------------------
// Mocks — hoisted before any import
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('./setup-sidecar.js', () => ({
  copySidecarScript: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getSidecarClient, _resetSidecarClient, classifySidecarError, isSidecarRegression } from './sidecar.js';
import { copySidecarScript } from './setup-sidecar.js';

const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
const existsMock = existsSync as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Mock child process factory
// ---------------------------------------------------------------------------

interface MockProcess extends EventEmitter {
  stdin: { write: ReturnType<typeof vi.fn> };
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
}

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdin = { write: vi.fn().mockReturnValue(true) };
  proc.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() }) as MockProcess['stdout'];
  proc.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() }) as MockProcess['stderr'];
  proc.killed = false;
  proc.kill = vi.fn();
  return proc;
}

// Helper: emit a JSON-RPC response on the process stdout
function emitResponse(proc: MockProcess, response: object): void {
  proc.stdout.emit('data', JSON.stringify(response) + '\n');
}

// Flush microtask queue to let async spawning complete
function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  _resetSidecarClient();
});

afterEach(() => {
  _resetSidecarClient();
});

// ---------------------------------------------------------------------------
// Test 1: isAvailable() returns false when sidecar binary path does not exist
// ---------------------------------------------------------------------------

describe('isAvailable()', () => {
  it('returns false when script and venv do not exist', () => {
    existsMock.mockReturnValue(false);
    const client = getSidecarClient();
    expect(client.isAvailable()).toBe(false);
  });

  it('returns true when both script and venv exist', () => {
    existsMock.mockReturnValue(true);
    const client = getSidecarClient();
    expect(client.isAvailable()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Successful analyze call
// ---------------------------------------------------------------------------

describe('analyze()', () => {
  it('resolves with AestheticsRawResult on successful JSON-RPC response', async () => {
    existsMock.mockReturnValue(true);
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const client = getSidecarClient();

    // Start analyze — don't await yet; we need to emit the response
    const analyzePromise = client.analyze('/tmp/test.wav', 0, 5);

    // Flush microtasks so ensureRunning() completes and pending is registered
    await flushMicrotasks();

    // Now emit the response
    emitResponse(proc, {
      jsonrpc: '2.0',
      id: 1,
      result: {
        CE: 5.15,
        CU: 5.78,
        PC: 2.15,
        PQ: 7.22,
        durationSeconds: 5.0,
        modelVersion: 'facebook/audiobox-aesthetics',
      },
    });

    const result = await analyzePromise;
    expect(result.CE).toBe(5.15);
    expect(result.CU).toBe(5.78);
    expect(result.PC).toBe(2.15);
    expect(result.PQ).toBe(7.22);
    expect(result.modelVersion).toBe('facebook/audiobox-aesthetics');
  });

  it('refreshes the installed scripts from this build before spawning', async () => {
    existsMock.mockReturnValue(true);
    spawnMock.mockReturnValue(createMockProcess());
    void getSidecarClient().analyze('/tmp/test.wav', 0, 5).catch(() => undefined);
    await flushMicrotasks();
    expect(copySidecarScript).toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalled();
  });

  it('sends correct JSON-RPC request to stdin', async () => {
    existsMock.mockReturnValue(true);
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const client = getSidecarClient();
    const analyzePromise = client.analyze('/tmp/audio.wav', 1.5, 6.5);

    await flushMicrotasks();

    emitResponse(proc, {
      jsonrpc: '2.0',
      id: 1,
      result: { CE: 1, CU: 2, PC: 3, PQ: 4, durationSeconds: 5, modelVersion: 'test' },
    });

    await analyzePromise;

    const writtenLine = proc.stdin.write.mock.calls[0][0] as string;
    const req = JSON.parse(writtenLine);
    expect(req.jsonrpc).toBe('2.0');
    expect(req.method).toBe('analyze');
    expect(req.params.path).toBe('/tmp/audio.wav');
    expect(req.params.startTime).toBe(1.5);
    expect(req.params.endTime).toBe(6.5);
  });

  // -------------------------------------------------------------------------
  // Test 3: Process crash mid-request — verify promise rejects
  // -------------------------------------------------------------------------

  it('rejects pending request on unexpected process exit', async () => {
    existsMock.mockReturnValue(true);
    const proc1 = createMockProcess();
    const proc2 = createMockProcess();
    // First spawn returns proc1, restart spawn returns proc2
    spawnMock
      .mockReturnValueOnce(proc1)
      .mockReturnValueOnce(proc2);

    const client = getSidecarClient();

    // Attach a catch to prevent unhandled rejection during the restart
    const analyzePromise = client.analyze('/tmp/crash.wav', 0, 5);
    const caughtPromise = analyzePromise.catch((err: Error) => err);

    // Wait for pending to be registered
    await flushMicrotasks();

    // Simulate process crash before response is sent
    proc1.emit('exit', 1);

    // Wait for restart attempt and rejection
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    const result = await caughtPromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBeTruthy();
  }, 10000);

  // -------------------------------------------------------------------------
  // Test 4: Malformed JSON from sidecar
  // -------------------------------------------------------------------------

  it('rejects on malformed JSON response', async () => {
    existsMock.mockReturnValue(true);
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const client = getSidecarClient();
    const analyzePromise = client.analyze('/tmp/bad.wav', 0, 5);

    await flushMicrotasks();

    proc.stdout.emit('data', 'not valid json\n');

    await expect(analyzePromise).rejects.toThrow(/malformed JSON/i);
  });

  // -------------------------------------------------------------------------
  // Test 5: JSON-RPC error response
  // -------------------------------------------------------------------------

  it('rejects with error message from JSON-RPC error response', async () => {
    existsMock.mockReturnValue(true);
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const client = getSidecarClient();
    const analyzePromise = client.analyze('/tmp/short.wav', 0, 0.3);

    await flushMicrotasks();

    emitResponse(proc, {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32000, message: 'Audio too short: 0.30s (minimum 0.5s)' },
    });

    await expect(analyzePromise).rejects.toThrow('Audio too short: 0.30s (minimum 0.5s)');
  });

  // -------------------------------------------------------------------------
  // Test 6: analyze throws when sidecar not installed
  // -------------------------------------------------------------------------

  it('throws immediately when sidecar is not available', async () => {
    existsMock.mockReturnValue(false);

    const client = getSidecarClient();
    await expect(client.analyze('/tmp/any.wav', 0, 5)).rejects.toThrow(/not installed|setup-sidecar/i);
  });
});

// ---------------------------------------------------------------------------
// Test 7: shutdown()
// ---------------------------------------------------------------------------

describe('queued requests', () => {
  it('a request waiting behind a long separation keeps its own timeout and does not kill the sidecar', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      existsMock.mockReturnValue(true);
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);
      const client = getSidecarClient();

      const separation = client.separate({ path: '/tmp/song.wav' } as never, 300_000);
      await flushMicrotasks();
      const queued = client.analyzeAudio({ path: '/tmp/ref.wav' } as never);
      await flushMicrotasks();

      // Two minutes in, past the 60 s default: the separation is still working.
      vi.advanceTimersByTime(120_000);
      await flushMicrotasks();
      expect(proc.kill).not.toHaveBeenCalled();

      emitResponse(proc, { jsonrpc: '2.0', id: 1, result: { stems: [] } });
      await expect(separation).resolves.toEqual({ stems: [] });
      await flushMicrotasks();
      emitResponse(proc, { jsonrpc: '2.0', id: 2, result: { integratedLufs: -14 } });
      await expect(queued).resolves.toEqual({ integratedLufs: -14 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a request as busy once it has waited five minutes behind a separation, and the separation carries on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      existsMock.mockReturnValue(true);
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);
      const client = getSidecarClient();

      const separation = client.separate({ path: '/tmp/song.wav' } as never, 1_800_000);
      await flushMicrotasks();
      const queued = client.analyzeAudio({ path: '/tmp/ref.wav' } as never);
      const refused = expect(queued).rejects.toThrow(/Sidecar busy: waited 300 s behind separate/);
      await flushMicrotasks();

      vi.advanceTimersByTime(300_001);
      await refused;
      expect(proc.kill).not.toHaveBeenCalled();

      emitResponse(proc, { jsonrpc: '2.0', id: 1, result: { stems: [] } });
      await expect(separation).resolves.toEqual({ stems: [] });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('shutdown()', () => {
  it('kills the process if running and rejects pending promises', async () => {
    existsMock.mockReturnValue(true);
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const client = getSidecarClient();
    // Start a request
    const p = client.analyze('/tmp/x.wav', 0, 5);

    // Wait for pending to be registered
    await flushMicrotasks();

    // Shut down — should reject pending promises and kill process
    client.shutdown();

    await expect(p).rejects.toThrow(/shut down/i);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('is safe to call when no process running', () => {
    existsMock.mockReturnValue(false);
    const client = getSidecarClient();
    expect(() => client.shutdown()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Failure severity: expected outcomes warn, regressions fail the span
// ---------------------------------------------------------------------------

describe('failed requests in telemetry', () => {
  const spans = new tracing.InMemorySpanExporter();

  beforeAll(() => {
    trace.setGlobalTracerProvider(
      new tracing.BasicTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(spans)] }),
    );
  });

  beforeEach(() => {
    spans.reset();
  });

  /** Run one analyze() the sidecar answers with this JSON-RPC error; return its span and the log level it wrote. */
  async function failAnalyze(error: { code: number; message: string }): Promise<{ span: tracing.ReadableSpan; level: string }> {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stderr.mockClear();
    existsMock.mockReturnValue(true);
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);
    const analyzePromise = getSidecarClient().analyze('/tmp/clip.wav', 0, 5);
    await flushMicrotasks();
    emitResponse(proc, { jsonrpc: '2.0', id: 1, error });
    await expect(analyzePromise).rejects.toThrow(error.message);
    const logged = stderr.mock.calls
      .map((c) => { try { return JSON.parse(String(c[0])) as { level?: string; event?: string }; } catch { return {}; } })
      .find((line) => line.event === 'reaper.sidecar.request.failed');
    const [span] = spans.getFinishedSpans();
    return { span, level: logged?.level ?? '' };
  }

  it.each([
    { code: -32000, message: 'Audio too short: 0.30s (minimum 0.5s)' },
    { code: -32000, message: 'Audio file not found: /tmp/clip.wav' },
    { code: -32602, message: 'bpm must be between 40 and 240' },
  ])('reports input the sidecar rejected as an expected failure: $message', async (error) => {
    const { span, level } = await failAnalyze(error);

    expect(span.name).toBe('sidecar/analyze');
    expect(span.attributes['error.type']).toBe('sidecar_rejected');
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
    expect(level).toBe('warn');
  });

  it('reports an analysis that raised as a regression', async () => {
    const { span, level } = await failAnalyze({ code: -32000, message: 'Inference failed: CUDA out of memory' });

    expect(span.attributes['error.type']).toBe('sidecar_error');
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(level).toBe('error');
  });

  it.each([
    ['Sidecar timeout after 60000ms. Override with REAPER_MCP_SIDECAR_TIMEOUT_MS env var.', 'timeout', true],
    ['Sidecar busy: waited 300 s behind separate — retry when it finishes', 'busy', false],
    ['Audio understanding sidecar not installed. Run reaper-mcp setup-sidecar', 'not_installed', false],
    ['audiobox-aesthetics not installed: No module named \'audiobox_aesthetics\'. Run in a terminal: reaper-mcp setup-sidecar', 'not_installed', false],
    ['Stem separation is not installed. Run: reaper-mcp setup-sidecar --with-separation', 'not_installed', false],
    ['Voice arrangement preview failed: FluidSynth native library is not installed or could not be loaded.', 'not_installed', false],
    ['Failed to initialize predictor: CUDA error', 'sidecar_error', true],
    ['Sidecar restarted; please retry the operation', 'sidecar_error', true],
  ] as const)('classifies "%s" as %s (regression: %s)', (message, type, regression) => {
    expect(classifySidecarError(new Error(message))).toBe(type);
    expect(isSidecarRegression(classifySidecarError(new Error(message)))).toBe(regression);
  });
});
