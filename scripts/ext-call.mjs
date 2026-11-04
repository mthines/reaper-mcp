#!/usr/bin/env node
// Call a tool on a freshly started `reaper-mcp serve`, the way Claude Code would, and print the result.
//
//   node scripts/ext-call.mjs --list [prefix]          list tool names (optionally those starting with prefix)
//   node scripts/ext-call.mjs <tool> ['<json args>']   call one tool; exit 1 when it returns an error
//
// Why: a running Claude Code session only sees an extension's tools after it restarts its MCP server. This starts
// its own server from the built bundle (pnpm nx build reaper-mcp-server), which loads every installed extension,
// so a new or rebuilt extension can be tried straight away against the live bridge.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const main = join(root, 'dist', 'apps', 'reaper-mcp-server', 'main.js');
if (!existsSync(main)) {
  console.error(`No build at ${main}. Run: pnpm nx build reaper-mcp-server`);
  process.exit(2);
}

const [first, second] = process.argv.slice(2);
if (!first) {
  console.error('Usage: ext-call.mjs --list [prefix] | <tool> [json args]');
  process.exit(2);
}

const transport = new StdioClientTransport({ command: 'node', args: [main, 'serve'], stderr: 'pipe' });
const skipped = [];
transport.stderr?.on('data', (d) => {
  for (const line of String(d).split('\n')) if (/Extension .* skipped/.test(line)) skipped.push(line.trim());
});
const client = new Client({ name: 'ext-call', version: '0' });
await client.connect(transport);

let code = 0;
try {
  if (first === '--list') {
    const names = (await client.listTools()).tools.map((t) => t.name).filter((n) => !second || n.startsWith(second));
    console.log(names.join('\n'));
  } else {
    let args = {};
    try {
      args = second ? JSON.parse(second) : {};
    } catch (err) {
      console.error(`Arguments are not valid JSON: ${err.message}`);
      process.exit(2);
    }
    const res = await client.callTool({ name: first, arguments: args });
    const text = (res.content ?? []).map((c) => c.text ?? '').join('\n');
    console.log(text);
    if (res.isError) code = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  code = 1;
} finally {
  for (const s of skipped) console.error(s);
  await client.close().catch(() => undefined);
}
process.exit(code);
