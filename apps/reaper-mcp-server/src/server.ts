import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { getTracer, emitLog, exceptionAttributes, getToolDurationHistogram, redactHome } from './telemetry.js';
import { classifyBridgeError, isSystemError } from './bridge.js';
import { collectPageLinks, withPageLink } from './page-link.js';
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
import { registerArrangeTools } from './tools/arrange.js';
import { registerFxHousekeepingTools } from './tools/fx-housekeeping.js';
import { registerCategoryTools } from './tools/categories.js';
import { registerAestheticsTools } from './tools/aesthetics.js';
import { registerOfflineTools } from './tools/offline.js';
import { registerTransientTools } from './tools/transients.js';
import { registerMixcheckTools } from './tools/mixcheck.js';
import { registerMixingTools } from './tools/mixing.js';
import { registerAlignTools } from './tools/align.js';
import { registerCompositionTools } from './tools/composition.js';
import { registerVoiceSketchTools } from './tools/voice-sketch.js';
import { registerKnowledgeTools } from './tools/knowledge.js';
import { registerPluginResearchTools } from './tools/plugin-research.js';
import { registerJsfxTools } from './tools/jsfx.js';
import { registerPluginBuildTools } from './tools/plugin-build.js';

// Cap for free-text error messages on span status (full text goes to the log).
const MAX_STATUS_MESSAGE = 256;

/**
 * The failure message of every failed tool call, as the agent got it (home directory
 * redacted, capped). A refused request leaves the span status unset, which carries no
 * description, so this is the one place its text is on the span. Free text can name
 * tracks, plugins or paths: the anonymized usage telemetry drops it (not in
 * ALLOWED_SPAN_ATTRIBUTES, telemetry-consent.ts); a custom OTEL_* exporter gets it.
 */
const TOOL_ERROR_MESSAGE = 'reaper.tool.error.message';

/**
 * Wraps server.tool() so every tool callback runs inside a SERVER span that
 * follows the OTel MCP semantic conventions: `tools/call {tool}` with
 * `mcp.method.name`, `gen_ai.tool.name`, `jsonrpc.request.id`, and `error.type`
 * (`tool_error` when the result has `isError`) with the failure message in
 * `reaper.tool.error.message`. The span parents the CLIENT
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
            const collected = await collectPageLinks(() => originalCb(...cbArgs));
            const result = withPageLink(collected.result, collected.links);
            const res = result as { isError?: boolean; content?: { text?: string }[] };
            if (res?.isError) {
              // Tool-level failure reported to the client (semconv: error.type=tool_error).
              // A refused request ("Track 9 not found") leaves the status unset, like an
              // HTTP 4xx; only system errors mark the span as failed. No log: the
              // bridge/sidecar call below already logged the cause.
              const errorText = res.content?.[0]?.text ?? 'Tool error';
              const message = redactHome(errorText).slice(0, MAX_STATUS_MESSAGE);
              metricAttrs['error.type'] = 'tool_error';
              span.setAttribute('error.type', 'tool_error');
              span.setAttribute(TOOL_ERROR_MESSAGE, message);
              if (isSystemError(classifyBridgeError(errorText.replace(/^Error:\s*/, '')))) {
                span.setStatus({ code: SpanStatusCode.ERROR, message });
              }
            }
            return result;
          } catch (err) {
            const errorType = err instanceof Error ? err.name : 'Error';
            const message = redactHome(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
            metricAttrs['error.type'] = errorType;
            span.setAttribute('error.type', errorType);
            span.setAttribute(TOOL_ERROR_MESSAGE, message.slice(0, MAX_STATUS_MESSAGE));
            span.setStatus({ code: SpanStatusCode.ERROR, message });
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
  registerArrangeTools(server);
  registerFxHousekeepingTools(server);
  registerCategoryTools(server);
  registerAestheticsTools(server);
  registerOfflineTools(server);
  registerTransientTools(server);
  registerMixcheckTools(server);
  registerMixingTools(server);
  registerAlignTools(server);
  registerCompositionTools(server);
  registerVoiceSketchTools(server);
  registerKnowledgeTools(server);
  registerPluginResearchTools(server);
  registerJsfxTools(server);
  registerPluginBuildTools(server);

  return server;
}
