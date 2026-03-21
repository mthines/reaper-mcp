import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerProjectTools } from './tools/project.js';
import { registerTrackTools } from './tools/tracks.js';
import { registerFxTools } from './tools/fx.js';
import { registerMeterTools } from './tools/meters.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'reaper-mcp',
    version: '0.1.0',
  });

  registerProjectTools(server);
  registerTrackTools(server);
  registerFxTools(server);
  registerMeterTools(server);

  return server;
}
