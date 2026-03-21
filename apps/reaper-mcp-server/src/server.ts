import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'reaper-mcp',
    version: '0.1.0',
  });

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

  return server;
}
