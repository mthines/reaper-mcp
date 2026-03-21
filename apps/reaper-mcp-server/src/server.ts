import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { getTracer } from './telemetry.js';
import { registerProjectTools } from './tools/project.js';
import { registerTrackTools } from './tools/tracks.js';
import { registerFxTools } from './tools/fx.js';
import { registerMeterTools } from './tools/meters.js';
import { registerTransportTools } from './tools/transport.js';
import { registerDiscoveryTools } from './tools/discovery.js';
import { registerPresetTools } from './tools/presets.js';
import { registerSnapshotTools } from './tools/snapshots.js';
import { registerRoutingTools } from './tools/routing.js';
import { registerAnalysisTools } from './tools/analysis.js';
import { registerMidiTools } from './tools/midi.js';
import { registerMediaTools } from './tools/media.js';
import { registerSelectionTools } from './tools/selection.js';
import { registerMarkerTools } from './tools/markers.js';
import { registerTempoTools } from './tools/tempo.js';
import { registerEnvelopeTools } from './tools/envelopes.js';

/**
 * Wraps server.tool() so every tool callback runs inside a SERVER span.
 * This produces `mcp.tool {toolName}` spans that parent the CLIENT bridge spans,
 * giving a full trace: tool invocation → bridge command → REAPER response.
 */
function instrumentToolHandlers(server: McpServer): void {
  const originalTool = server.tool.bind(server);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.tool = (...args: any[]) => {
    const toolName = args[0] as string;

    // The callback is always the last argument
    const cbIndex = args.length - 1;
    const originalCb = args[cbIndex] as (...cbArgs: unknown[]) => Promise<unknown>;

    args[cbIndex] = async (...cbArgs: unknown[]) => {
      const tracer = getTracer();
      return tracer.startActiveSpan(
        `mcp.tool ${toolName}`,
        { kind: SpanKind.SERVER, attributes: { 'mcp.tool.name': toolName } },
        async (span) => {
          try {
            const result = await originalCb(...cbArgs);
            // Check if the tool returned an error response
            const res = result as { isError?: boolean; content?: { text?: string }[] };
            if (res?.isError) {
              const errorText = res.content?.[0]?.text ?? 'Tool error';
              span.setStatus({ code: SpanStatusCode.ERROR, message: errorText });
              span.setAttribute('mcp.tool.error', errorText);
            }
            return result;
          } catch (err) {
            const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message });
            throw err;
          } finally {
            span.end();
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
  registerAnalysisTools(server);
  registerMidiTools(server);
  registerMediaTools(server);
  registerSelectionTools(server);
  registerMarkerTools(server);
  registerTempoTools(server);
  registerEnvelopeTools(server);

  return server;
}
