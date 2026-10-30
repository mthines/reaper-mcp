// Development server for the bridge: the status page with live reload, REAPER's /_/ API proxied over one
// connection, and the Lua scripts and JSFX installed into REAPER on save.
//
// Why proxy: REAPER's web server never frees a socket whose client hung up first, and near 100 of them it stops
// answering until REAPER restarts. A browser hangs up all the time while you develop (reloads, idle drops,
// devtools), so here the browser only talks to this server, and REAPER sees one connection for the session.
//
//   pnpm dev:bridge      → http://localhost:8098/mcp_bridge.html
//   BRIDGE_DEV_PORT, REAPER_WEB_PORT and REAPER_RESOURCE_PATH override the defaults.
import { context } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, watch } from 'node:fs';
import http from 'node:http';
import { homedir, platform } from 'node:os';
import { extname, join } from 'node:path';
import { buildOptions, here, renderHtml } from './build-config.mjs';

const PORT = Number(process.env.BRIDGE_DEV_PORT) || 8098;
const REAPER_PORT = Number(process.env.REAPER_WEB_PORT) || 8099;
const PUBLIC_DIR = join(here, 'public');
const REAPER_SRC = join(here, '../../reaper');
const RELOAD_SCRIPT = `<script>new EventSource('/__dev/events').onmessage = () => location.reload();</script>\n`;

// ---- The page: rebuilt in memory on every change, each open tab reloaded ----------------------------------

let html = '<!doctype html><title>MCP Bridge</title><p>Building…</p>';
const reloadClients = new Set();
const base = buildOptions();
const ctx = await context({
  ...base,
  minify: false,
  sourcemap: 'inline',
  define: { ...base.define, 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'dev-reload',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) return; // esbuild already printed them; keep serving the last good page
          html = renderHtml(result.outputFiles, RELOAD_SCRIPT);
          log(`page rebuilt (${(html.length / 1024).toFixed(0)} KB), reloading ${reloadClients.size} tab(s)`);
          for (const res of reloadClients) res.write('data: reload\n\n');
        });
      },
    },
  ],
});
await ctx.watch();

// ---- REAPER's /_/ API, over one keep-alive connection ------------------------------------------------------

// maxSockets 1 queues requests on one socket; REAPER closes it when idle (a close it does free), and the
// agent opens the next one on demand. Requests are never aborted: aborting would close the socket from this
// side, the one close REAPER never frees, so a browser that goes away leaves its request to finish here.
const reaperAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });

function reaperGet(path, retried = false) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: REAPER_PORT, path, agent: reaperAgent }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    // A reused socket REAPER closed a moment ago: send once more on a fresh one
    req.on('error', (err) => (!retried && err.code === 'ECONNRESET' ? reaperGet(path, true).then(resolve, reject) : reject(err)));
  });
}

async function proxy(req, res) {
  try {
    const up = await reaperGet(req.url);
    res.writeHead(up.status, {
      'content-type': up.headers['content-type'] ?? 'text/plain',
      'cache-control': 'no-cache',
    });
    res.end(up.body);
  } catch (err) {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`REAPER web interface unreachable on port ${REAPER_PORT}: ${err.code ?? err.message}`);
  }
}

// ---- Lua scripts and JSFX: installed into REAPER on save, the bridge restarted for Lua ----------------------

function reaperResourcePath() {
  if (process.env.REAPER_RESOURCE_PATH) return process.env.REAPER_RESOURCE_PATH;
  const home = homedir();
  if (platform() === 'darwin') return join(home, 'Library', 'Application Support', 'REAPER');
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'REAPER');
  return join(home, '.config', 'REAPER');
}

// The files setup installs, read from the server's REAPER_ASSETS so there's one list
const cliSrc = readFileSync(join(here, '../reaper-mcp-server/src/cli.ts'), 'utf-8');
const assetList = cliSrc.match(/REAPER_ASSETS = \[([\s\S]*?)\]/)?.[1];
if (!assetList) throw new Error('bridge dev: could not read REAPER_ASSETS from reaper-mcp-server/src/cli.ts');
const ASSETS = new Set([...assetList.matchAll(/'([^']+)'/g)].map((m) => m[1]));

const resource = reaperResourcePath();
const destOf = (name) => (name.endsWith('.lua') ? join(resource, 'Scripts', name) : join(resource, 'Effects', 'reaper-mcp', name));

/** Copy a changed asset into REAPER; true when the installed copy differed. */
function install(name) {
  const src = join(REAPER_SRC, name);
  const dest = destOf(name);
  if (!existsSync(src)) return false;
  const next = readFileSync(src);
  if (existsSync(dest) && readFileSync(dest).equals(next)) return false;
  mkdirSync(join(dest, '..'), { recursive: true });
  copyFileSync(src, dest);
  return true;
}

/** Ask the running bridge to restart into the installed copy, with the token only its status feed carries. */
async function restartBridge() {
  try {
    const body = (await reaperGet('/_/GET/EXTSTATE/MCPBridge/status')).body.toString();
    const token = body.match(/"token":"([0-9a-f]+)"/)?.[1];
    if (!token || !/"canRestart":true/.test(body)) {
      log('bridge not restartable from here: stop mcp_bridge.lua in REAPER and run it again');
      return;
    }
    await reaperGet(`/_/SET/EXTSTATE/MCPBridge/request/restart-${token}`);
    log('bridge restarting');
  } catch (err) {
    log(`bridge not reachable (${err.code ?? err.message}); start mcp_bridge.lua in REAPER`);
  }
}

let pending = new Set();
let timer;
watch(REAPER_SRC, (_event, file) => {
  if (!file || !ASSETS.has(file)) return;
  pending.add(file);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const changed = [...pending].filter(install);
    pending = new Set();
    if (!changed.length) return;
    log(`installed ${changed.join(', ')}`);
    if (changed.some((f) => f.endsWith('.lua'))) void restartBridge();
    else log('JSFX: remove and re-add the plugin (or reopen the project) to load the new code');
  }, 300); // editors save in several writes
});

// ---- HTTP -------------------------------------------------------------------------------------------------

const TYPES = { '.png': 'image/png', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

http
  .createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path.startsWith('/_/')) return void proxy(req, res);
    if (path === '/__dev/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      reloadClients.add(res);
      req.on('close', () => reloadClients.delete(res));
      return;
    }
    if (path === '/' || path === '/mcp_bridge.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return void res.end(html);
    }
    const file = join(PUBLIC_DIR, path.replace(/^\/+/, ''));
    if (file.startsWith(PUBLIC_DIR) && existsSync(file)) {
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      return void res.end(readFileSync(file));
    }
    res.writeHead(404).end();
  })
  .listen(PORT, '127.0.0.1', () => {
    log(`http://localhost:${PORT}/mcp_bridge.html  (REAPER on ${REAPER_PORT}, one connection; installs into ${resource})`);
  });

function log(message) {
  console.log(`[bridge dev ${new Date().toTimeString().slice(0, 8)}] ${message}`);
}
