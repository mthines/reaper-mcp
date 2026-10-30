import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { getTracer, emitLog, exceptionAttributes, getToolDurationHistogram, redactHome } from './telemetry.js';
import { classifyBridgeError, isSystemError } from './bridge.js';
import { registerProjectTools } from './tools/project.js';
import { registerTrackTools } from './tools/tracks.js';
import { registerFxTools } from './tools/fx.js';
import { registerMeterTools } from './tools/meters.js';
import { registerTransportTools } from './tools/transport.js';
import { registerDiscoveryTools } from './tools/discovery.js';
import { registerPresetTools } from './tools/presets.js';
import { registerSnapshotTools } from './tools/snapshots.js';
import { registerRoutingTools } from './tools/routing.js';
import { registerStructureTools, registerRoutingSetters } from './tools/structure.js';
import { registerAnalysisTools } from './tools/analysis.js';
import { registerMidiTools } from './tools/midi.js';
import { registerMediaTools } from './tools/media.js';
import { registerSelectionTools } from './tools/selection.js';
import { registerRecordingTools } from './tools/recording.js';
import { registerMarkerTools } from './tools/markers.js';
import { registerTempoTools } from './tools/tempo.js';
import { registerEnvelopeTools } from './tools/envelopes.js';
import { registerBatchTools } from './tools/batch.js';
import { registerPlanTools } from './tools/plan.js';
import { registerActionTools } from './tools/actions.js';
import { registerItemTools } from './tools/items.js';
import { registerFxHousekeepingTools } from './tools/fx-housekeeping.js';
import { registerCategoryTools } from './tools/categories.js';
import { registerAestheticsTools } from './tools/aesthetics.js';
import { registerOfflineTools } from './tools/offline.js';
import { registerTransientTools } from './tools/transients.js';
import { registerKnowledgeTools } from './tools/knowledge.js';

// Cap for free-text error messages on span status (full text goes to the log).
const MAX_STATUS_MESSAGE = 256;

/**
 * Wraps server.tool() so every tool callback runs inside a SERVER span that
 * follows the OTel MCP semantic conventions: `tools/call {tool}` with
 * `mcp.method.name`, `gen_ai.tool.name`, `jsonrpc.request.id`, and `error.type`
 * (`tool_error` when the result has `isError`). The span parents the CLIENT
 * bridge spans: tool invocation → bridge command → REAPER response.
 *
 * Also records `mcp.server.operation.duration` per call.
 */
export function instrumentToolHandlers(server: McpServer): void {
  const originalTool = server.tool.bind(server);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.tool = (...args: any[]) => {
    const toolName = args[0] as string;

    // The callback is always the last argument
    const cbIndex = args.length - 1;
    const originalCb = args[cbIndex] as (...cbArgs: unknown[]) => Promise<unknown>;

    args[cbIndex] = async (...cbArgs: unknown[]) => {
      // The SDK passes RequestHandlerExtra as the last callback argument.
      const extra = cbArgs[cbArgs.length - 1] as { requestId?: string | number; sessionId?: string } | undefined;
      const startMs = Date.now();
      const metricAttrs: Record<string, string> = {
        'mcp.method.name': 'tools/call',
        'gen_ai.tool.name': toolName,
        'network.transport': 'pipe',
      };

      return getTracer().startActiveSpan(
        `tools/call ${toolName}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            ...metricAttrs,
            'gen_ai.operation.name': 'execute_tool',
            ...(extra?.requestId != null && { 'jsonrpc.request.id': String(extra.requestId) }),
            ...(extra?.sessionId && { 'mcp.session.id': extra.sessionId }),
          },
        },
        async (span) => {
          try {
            const result = await originalCb(...cbArgs);
            const res = result as { isError?: boolean; content?: { text?: string }[] };
            if (res?.isError) {
              // Tool-level failure reported to the client (semconv: error.type=tool_error).
              // A refused request ("Track 9 not found") leaves the status unset, like an
              // HTTP 4xx; only system errors mark the span as failed. No log: the
              // bridge/sidecar call below already logged the cause.
              const errorText = res.content?.[0]?.text ?? 'Tool error';
              metricAttrs['error.type'] = 'tool_error';
              span.setAttribute('error.type', 'tool_error');
              if (isSystemError(classifyBridgeError(errorText.replace(/^Error:\s*/, '')))) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: redactHome(errorText).slice(0, MAX_STATUS_MESSAGE) });
              }
            }
            return result;
          } catch (err) {
            const errorType = err instanceof Error ? err.name : 'Error';
            metricAttrs['error.type'] = errorType;
            span.setAttribute('error.type', errorType);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: redactHome(err instanceof Error ? `${err.name}: ${err.message}` : String(err)),
            });
            emitLog('error', `Tool ${toolName} threw`, {
              'gen_ai.tool.name': toolName,
              'error.type': errorType,
              ...exceptionAttributes(err),
            });
            throw err;
          } finally {
            span.end();
            getToolDurationHistogram().record((Date.now() - startMs) / 1000, metricAttrs);
          }
        },
      );
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalTool as any)(...args);
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'reaper-mcp',
    version: '0.1.0',
  });

  // Wrap server.tool() before any tools register
  instrumentToolHandlers(server);

  registerProjectTools(server);
  registerTrackTools(server);
  registerFxTools(server);
  registerMeterTools(server);
  registerTransportTools(server);
  registerDiscoveryTools(server);
  registerPresetTools(server);
  registerSnapshotTools(server);
  registerRoutingTools(server);
  registerRoutingSetters(server);
  registerStructureTools(server);
  registerAnalysisTools(server);
  registerMidiTools(server);
  registerMediaTools(server);
  registerSelectionTools(server);
  registerRecordingTools(server);
  registerMarkerTools(server);
  registerTempoTools(server);
  registerEnvelopeTools(server);
  registerBatchTools(server);
  registerPlanTools(server);
  registerActionTools(server);
  registerItemTools(server);
  registerFxHousekeepingTools(server);
  registerCategoryTools(server);
  registerAestheticsTools(server);
  registerOfflineTools(server);
  registerTransientTools(server);
  registerKnowledgeTools(server);

  return server;
}
