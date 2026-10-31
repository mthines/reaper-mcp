// Opens every command in a status feed recorded from the real bridge in the built page, in a real browser, at the
// narrowest, default and widest drawer, and fails when a view draws outside its drawer or the page logs an error.
//   node apps/bridge-ui/e2e/drawer-widths.mjs [dist dir] [status.json]
// Needs `pnpm nx build bridge-ui` first and a Chromium (`pnpm --filter @mthines/reaper-bridge-ui exec playwright install chromium`).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const dist = process.argv[2] ?? join(here, '../../../dist/apps/bridge-ui');
const status = JSON.parse(readFileSync(process.argv[3] ?? join(here, 'fixtures/status.json'), 'utf8'));

// The page shows a time range ending now: move the recording's clock to the present
const shift = Date.now() - Math.max(...status.recent.map((e) => e.t));
const TIME_KEYS = new Set(['t', 'ts', 'startedAt', 'first', 'last']);
const moved = JSON.stringify(status, (k, v) => (TIME_KEYS.has(k) && typeof v === 'number' ? v + shift : v));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
// REAPER's web API: one reply line per GET/EXTSTATE in the ;-separated request
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/_/')) {
    const lines = url.slice(3).split(';').filter((c) => c.startsWith('GET/EXTSTATE/')).map((c) => {
      const [, , section, key] = c.split('/');
      return `EXTSTATE\t${section}\t${key}\t${key === 'status' ? moved : ''}`;
    });
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(lines.join('\n') + '\n');
    return;
  }
  try {
    const body = readFileSync(join(dist, url));
    res.writeHead(200, { 'content-type': types[extname(url)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// Drawer width is stored as a share of the window and clamped to 320 px … 70%
const WIDTHS = [['narrowest', 0.01], ['default', null], ['widest', 0.7]];
const failures = [];
const browser = await chromium.launch();
try {
  for (const [label, share] of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    if (share !== null) await ctx.addInitScript((s) => localStorage.setItem('mcp_bridge.drawer_width', String(s)), share);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') failures.push(`${label}: console error: ${m.text()}`); });
    page.on('pageerror', (e) => failures.push(`${label}: page error: ${e.message}`));
    for (const e of status.recent) {
      await page.goto(`${origin}/mcp_bridge.html?view=calls&range=7d&entry=${e.n}`);
      const drawer = page.locator(`aside[aria-label="Details for ${e.c}"]`);
      try {
        await drawer.waitFor({ timeout: 10_000 });
      } catch {
        failures.push(`${label}: ${e.c}: the drawer did not open`);
        continue;
      }
      const outside = await drawer.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll('*')]
          .filter((x) => !x.closest('[role="separator"]'))
          .filter((x) => {
            const b = x.getBoundingClientRect();
            return b.width > 0 && b.height > 0 && (b.right > box.right + 1 || b.left < box.left - 1);
          })
          .slice(0, 3)
          .map((x) => `<${x.tagName.toLowerCase()}> "${(x.textContent ?? '').trim().slice(0, 40)}"`);
      });
      const width = Math.round((await drawer.boundingBox()).width);
      if (outside.length) failures.push(`${label} (${width}px): ${e.c}: drawn outside the drawer: ${outside.join(', ')}`);
      else console.log(`ok  ${label.padEnd(9)} ${String(width).padStart(4)}px  ${e.c}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
