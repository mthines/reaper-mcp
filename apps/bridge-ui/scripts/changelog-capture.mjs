#!/usr/bin/env node
// Capture a What's new highlight from the bridge page: a screenshot (.webp/.png) or a short looping clip (.mp4/.webm)
// of the page in ?demo, at the 16:10 stage every highlight card uses. Used by the /changelog-highlight skill.
//
//   node apps/bridge-ui/scripts/changelog-capture.mjs --out apps/bridge-ui/changelog/media/my-feature.mp4 \
//     --params 'demo' --steps '[{"click":"role=button[name=\"Update available\"]"},{"wait":800}]' --duration 6
//
// --url       page to open (default: the dev server, http://localhost:8098/mcp_bridge.html)
// --params    query string without "?" (default: demo)
// --steps     JSON array, run in order: {"click": sel} {"hover": sel} {"press": key} {"type": [sel, text]}
//             {"wait": ms} {"scroll": [sel, px]}; selectors are Playwright selectors (role=…, text=…, css)
// --crop      x,y,w,h in CSS px of the 1280x800 page to keep (keep w:h at 16:10, e.g. 560,0,720,450): what the
//             card shows is ~400 px wide, so crop to the feature or its text is unreadable. Default: the whole page.
// --clip      selector to crop a screenshot to instead (any shape; the card letterboxes it)
// --duration  seconds a clip runs after the steps start (default 6, max 12)
// --poster    also write the clip's last frame here (.webp/.png): the still for reduced motion
// Clips need ffmpeg (brew install ffmpeg) to trim and encode; screenshots need nothing but Playwright.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values: a } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:8098/mcp_bridge.html' },
    params: { type: 'string', default: 'demo' },
    steps: { type: 'string', default: '[]' },
    clip: { type: 'string' },
    crop: { type: 'string' },
    duration: { type: 'string', default: '6' },
    poster: { type: 'string' },
    out: { type: 'string' },
  },
});
if (!a.out) throw new Error('--out <file.webp|png|mp4|webm> is required');
const out = resolve(a.out);
const ext = extname(out).slice(1);
const video = ext === 'mp4' || ext === 'webm';
if (!['webp', 'png', 'mp4', 'webm'].includes(ext)) throw new Error(`unsupported output .${ext}`);
const steps = JSON.parse(a.steps);
const duration = Math.min(12, Math.max(1, Number(a.duration) || 6));
const SIZE = { width: 1280, height: 800 }; // 16:10, the highlight stage
const crop = a.crop ? a.crop.split(',').map(Number) : null;
if (crop && (crop.length !== 4 || crop.some((n) => !Number.isFinite(n) || n < 0) || crop[0] + crop[2] > SIZE.width || crop[1] + crop[3] > SIZE.height)) {
  throw new Error(`--crop must be x,y,w,h inside ${SIZE.width}x${SIZE.height}`);
}
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const tmp = mkdtempSync(join(tmpdir(), 'changelog-capture-'));
const browser = await chromium.launch();

async function run(page) {
  for (const s of steps) {
    if (s.click) await page.locator(s.click).first().click();
    else if (s.hover) await page.locator(s.hover).first().hover();
    else if (s.press) await page.keyboard.press(s.press);
    else if (s.type) await page.locator(s.type[0]).first().fill(s.type[1]);
    else if (s.scroll) await page.locator(s.scroll[0]).first().evaluate((el, px) => el.scrollBy({ top: px, behavior: 'smooth' }), s.scroll[1]);
    else if (s.wait) await page.waitForTimeout(s.wait);
    else throw new Error(`unknown step ${JSON.stringify(s)}`);
  }
}

// WebP through Chromium's own encoder (canvas), so it needs no ffmpeg built with libwebp
async function toWebp(png, file) {
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 0.86);
  }, `data:image/png;base64,${png.toString('base64')}`);
  await page.close();
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

async function still(page, file) {
  const box = crop ? { x: crop[0], y: crop[1], width: crop[2], height: crop[3] } : undefined;
  const png = a.clip && !box ? await page.locator(a.clip).first().screenshot() : await page.screenshot({ clip: box });
  if (extname(file) === '.webp') await toWebp(png, file);
  else writeFileSync(file, png);
}

try {
  const url = `${a.url}${a.params ? `?${a.params}` : ''}`;
  if (video) {
    // Playwright records at 1x whatever the device scale (a bigger size only pads the frame), so a clip is kept at
    // its native size: crop to the feature rather than scaling the page down
    const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: tmp, size: SIZE }, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForTimeout(1200); // first paint and the demo feed's first rows; trimmed below
    const started = Date.now();
    await run(page);
    await page.waitForTimeout(Math.max(0, duration * 1000 - (Date.now() - started)));
    if (a.poster) await still(page, resolve(a.poster));
    await context.close();
    const raw = join(tmp, readdirSync(tmp).find((f) => f.endsWith('.webm')));
    const trim = ['-ss', '1.1', '-t', String(duration)];
    const [x, y, w, h] = crop ?? [0, 0, SIZE.width, SIZE.height];
    const vf = ['-vf', `crop=${w - (w % 2)}:${h - (h % 2)}:${x}:${y}`];
    if (ext === 'webm') ffmpeg(...trim, '-i', raw, ...vf, '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', out);
    else ffmpeg(...trim, '-i', raw, ...vf, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart', out);
  } else {
    const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForTimeout(1200);
    await run(page);
    await page.waitForTimeout(400);
    await still(page, out);
  }
  console.log(`${out} (${Math.round(statSync(out).size / 1024)} KB)`);
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
