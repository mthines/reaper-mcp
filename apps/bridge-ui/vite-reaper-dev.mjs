// The dev server's REAPER side (`pnpm dev:bridge`): REAPER's /_/ API proxied over one connection, and the Lua
// scripts and JSFX installed into REAPER on save. Vite itself rebuilds and hot-reloads the page.
//
// Why not Vite's own proxy: REAPER's web server never frees a socket whose client hung up first, and near 100 of
// them it stops answering until REAPER restarts. A browser hangs up all the time while you develop (reloads, idle
// drops, devtools), and Vite's proxy passes each hang-up on to REAPER. Here REAPER sees one connection for the
// session and a request is always left to finish.
//
//   REAPER_WEB_PORT and REAPER_RESOURCE_PATH override the defaults; BRIDGE_DEV_PORT is read by vite.config.ts.
import { copyFileSync, existsSync, mkdirSync, readFileSync, watch } from 'node:fs';
import http from 'node:http';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { here } from './build-config.mjs';

const REAPER_PORT = Number(process.env.REAPER_WEB_PORT) || 8099;
const REAPER_SRC = join(here, '../../reaper');

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

async function proxy(path, res) {
  try {
    const up = await reaperGet(path);
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

/** The files setup installs, read from the server's REAPER_ASSETS so there's one list. */
function reaperAssets() {
  const cliSrc = readFileSync(join(here, '../reaper-mcp-server/src/cli.ts'), 'utf-8');
  const assetList = cliSrc.match(/REAPER_ASSETS = \[([\s\S]*?)\]/)?.[1];
  if (!assetList) throw new Error('bridge dev: could not read REAPER_ASSETS from reaper-mcp-server/src/cli.ts');
  return new Set([...assetList.matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

/** Copy a changed asset into REAPER; true when the installed copy differed. */
function install(resource, name) {
  const src = join(REAPER_SRC, name);
  const dest = name.endsWith('.lua') ? join(resource, 'Scripts', name) : join(resource, 'Effects', 'reaper-mcp', name);
  if (!existsSync(src)) return false;
  const next = readFileSync(src);
  if (existsSync(dest) && readFileSync(dest).equals(next)) return false;
  mkdirSync(join(dest, '..'), { recursive: true });
  copyFileSync(src, dest);
  return true;
}

/** Ask the running bridge to restart into the installed copy, with the token only its status feed carries. */
async function restartBridge(log) {
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

function watchReaperAssets(resource, log) {
  const assets = reaperAssets();
  let pending = new Set();
  let timer;
  return watch(REAPER_SRC, (_event, file) => {
    if (!file || !assets.has(file)) return;
    pending.add(file);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const changed = [...pending].filter((name) => install(resource, name));
      pending = new Set();
      if (!changed.length) return;
      log(`installed ${changed.join(', ')}`);
      if (changed.some((f) => f.endsWith('.lua'))) void restartBridge(log);
      else log('JSFX: remove and re-add the plugin (or reopen the project) to load the new code');
    }, 300); // editors save in several writes
  });
}

// ---- The plugin -------------------------------------------------------------------------------------------

/** Dev server only (`apply: 'serve'`); Storybook drops it by name, so it never touches REAPER. */
export function reaperDev() {
  return {
    name: 'reaper-dev',
    apply: 'serve',
    configureServer(server) {
      const log = (message) => server.config.logger.info(`[bridge dev] ${message}`, { timestamp: true });
      const resource = reaperResourcePath();
      const watcher = watchReaperAssets(resource, log);
      server.httpServer?.once('close', () => watcher.close());
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '/';
        if (url.startsWith('/_/')) return void proxy(url, res);
        if (url === '/' || url.startsWith('/?')) {
          res.writeHead(302, { location: `/mcp_bridge.html${url.slice(1)}` });
          return void res.end();
        }
        next();
      });
      server.httpServer?.once('listening', () => {
        const page = `http://localhost:${server.config.server.port}/mcp_bridge.html`;
        server.config.logger.info(
          [
            '',
            '  MCP Bridge page (dev)',
            `  Live:  ${page}         REAPER's web interface on ${REAPER_PORT}, one connection`,
            `  Demo:  ${page}?demo    no REAPER needed: a fake bridge with every tool view in the log`,
            `  Lua/JSFX saves install into ${resource}`,
            '',
          ].join('\n'),
        );
      });
    },
  };
}
