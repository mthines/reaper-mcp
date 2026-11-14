#!/usr/bin/env node
// Draws the three share pictures (1200x630) a link to the hosted site unfurls with: docs, changelog, bridge.
// One frame, three motifs, so they read as a set. Output is committed in apps/bridge-ui/share/; run this after
// changing a design:  node apps/bridge-ui/scripts/og-images.mjs
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../share');
mkdirSync(out, { recursive: true });
const icon = `data:image/png;base64,${readFileSync(join(here, '../public/mcp_bridge_icon_512.png')).toString('base64')}`;

const frame = ({ kind, label, title, lines, url, art }) => `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;background:#0e0f11;color:#e7e9ec;font:400 28px/1.35 -apple-system,Inter,'Segoe UI',sans-serif;position:relative}
.glow{position:absolute;inset:0;background:radial-gradient(900px 520px at 88% 8%,rgba(124,196,255,.20),transparent 60%),radial-gradient(700px 480px at 4% 108%,rgba(196,165,255,.16),transparent 60%)}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(120deg,#000 0,transparent 70%)}
.brand{position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:16px;font-weight:600;font-size:30px}
.brand img{width:56px;height:56px;border-radius:14px}
.brand span{color:#8a909a;font-weight:500}
.chip{position:absolute;left:72px;top:176px;padding:6px 18px;border-radius:999px;border:2px solid rgba(124,196,255,.55);color:#7cc4ff;font:600 22px/1.4 ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:.12em}
main{position:absolute;left:72px;top:232px;width:530px}
h1{font-size:64px;line-height:1.06;font-weight:700;letter-spacing:-.02em}
h1 em{font-style:normal;background:linear-gradient(90deg,#7cc4ff,#c4a5ff);-webkit-background-clip:text;color:transparent}
p{margin-top:22px;color:#8a909a;font-size:27px}
.url{position:absolute;left:72px;bottom:52px;font:500 24px ui-monospace,'SF Mono',Menlo,monospace;color:#6d7480}
.bars{position:absolute;right:72px;bottom:48px;display:flex;align-items:flex-end;gap:6px;height:40px}
.bars i{width:6px;border-radius:3px;background:linear-gradient(#7cc4ff,#c4a5ff);opacity:.7}
.art{position:absolute;left:640px;top:84px;width:520px;height:462px;transform:rotate(2deg);border-radius:28px;border:2px solid #2f333a;background:#15171a;box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(124,196,255,.08);overflow:hidden;padding:30px}
.dot{display:inline-block;width:14px;height:14px;border-radius:50%;background:#2f333a;margin-right:8px}
.mono{font-family:ui-monospace,'SF Mono',Menlo,monospace}
.muted{color:#8a909a}.acc{color:#7cc4ff}.ok{color:#4ade80}.bad{color:#f87171}.warn{color:#f5b84b}
</style><div class="glow"></div><div class="grid"></div>
<div class="brand"><img src="${icon}">reaper-mcp <span>${kind}</span></div>
<div class="chip">${label}</div>
<main><h1>${title}</h1><p>${lines}</p></main>
<div class="url">${url}</div>
<div class="bars">${[18,30,22,38,26,14,34,20,28,12,32,24].map((h) => `<i style="height:${h}px"></i>`).join('')}</div>
<div class="art">${art}</div>`;

const docsArt = `<div style="font-size:22px">
<div class="muted" style="letter-spacing:.1em;font-size:18px;margin-bottom:10px">GETTING STARTED</div>
<div style="border-left:2px solid #2f333a;padding-left:0;position:relative;margin-bottom:26px">
 <div style="position:absolute;left:-2px;top:46px;width:4px;height:44px;background:#7cc4ff;border-radius:2px"></div>
 <div class="muted" style="padding:8px 18px">What this is</div>
 <div style="padding:8px 18px;color:#e7e9ec;background:rgba(255,255,255,.05);border-radius:8px">Install and connect</div>
 <div class="muted" style="padding:8px 18px">Your first conversation</div></div>
<div class="muted" style="letter-spacing:.1em;font-size:18px;margin-bottom:12px">TERMINAL</div>
<div class="mono" style="background:#0e0f11;border:2px solid #2f333a;border-radius:14px;padding:18px 22px;font-size:21px;line-height:1.7">
 <div><span class="muted">$</span> npm i -g @mthines/reaper-mcp</div>
 <div><span class="muted">$</span> reaper-mcp setup</div>
 <div><span class="muted">$</span> reaper-mcp init <span class="ok">&#10003;</span></div></div></div>`;

const card = (v, tag, tone, a, b) => `<div style="border:2px solid #2f333a;border-radius:16px;padding:12px 22px;margin-bottom:12px;background:#1b1d21">
 <div style="display:flex;justify-content:space-between;align-items:center"><span class="mono" style="font-size:24px;font-weight:600">${v}</span><span class="${tone} mono" style="font-size:17px;letter-spacing:.1em;border:2px solid currentColor;border-radius:999px;padding:2px 12px">${tag}</span></div>
 <div style="margin-top:6px;font-size:21px">${a}</div><div class="muted" style="font-size:19px;margin-top:4px">${b}</div></div>`;
const changelogArt = `<div class="muted mono" style="font-size:18px;letter-spacing:.1em;margin-bottom:16px">WHAT&rsquo;S NEW</div>
${card('Docs', 'NEW', 'acc', 'Docs for musicians, in plain words', 'Search them from &#8984;K')}
${card('Harnesses', 'NEW', 'acc', 'Codex, Gemini CLI and Cursor too', 'reaper-mcp init finds them')}
${card('Plugins', 'NEW', 'acc', 'Drum pads and a step sequencer', '/make-plugin')}`;

const row = (n, ms, w, ok = true) => `<div style="display:flex;align-items:center;gap:14px;padding:11px 0;border-bottom:1px solid #23262b;font-size:21px"><span class="${ok ? 'ok' : 'bad'}">&#9679;</span><span class="mono" style="flex:1">${n}</span><span style="width:${w}px;height:6px;border-radius:3px;background:#3f6f9f"></span><span class="mono muted" style="width:86px;text-align:right">${ms}</span></div>`;
const bridgeArt = `<div style="display:flex;gap:14px;margin-bottom:18px">
 ${[['COMMANDS', '1,109', ''], ['ERRORS', '53', 'bad'], ['LATENCY', '234 ms', '']].map(([k, v, c]) => `<div style="flex:1;border:2px solid #2f333a;border-radius:14px;padding:12px 14px;background:#1b1d21"><div class="muted mono" style="font-size:15px;letter-spacing:.1em">${k}</div><div class="${c}" style="font-size:30px;font-weight:600;margin-top:2px">${v}</div></div>`).join('')}</div>
<div style="display:flex;align-items:flex-end;gap:6px;height:84px;margin-bottom:14px">${[28,40,34,52,44,60,38,70,46,64,58,76,50,66,72].map((h, i) => `<i style="flex:1;height:${h}px;border-radius:3px;background:${i === 11 ? '#7cc4ff' : '#3f6f9f'}"></i>`).join('')}</div>
${row('measure_masking', '6.9 s', 90)}${row('set_fx_parameter', '0.9 ms', 14)}${row('insert_midi_notes', '4.2 ms', 22)}${row('run_plan', '20 ms', 40)}`;

const pages = {
  docs: { kind: 'docs', label: 'DOCS', title: 'A music assistant <em>inside REAPER</em>', lines: 'Plain guides. You make every call.', url: 'reaper-mcp.vercel.app/docs', art: docsArt },
  changelog: { kind: 'changelog', label: 'WHAT&rsquo;S NEW', title: 'Every release, <em>shown</em>', lines: 'The changes, not just a list of them.', url: 'reaper-mcp.vercel.app/changelog', art: changelogArt },
  bridge: { kind: 'bridge', label: 'LIVE DEMO', title: 'See what it <em>did</em>, step by step', lines: 'Every move in your session, with before and after.', url: 'reaper-mcp.vercel.app', art: bridgeArt },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [name, p] of Object.entries(pages)) {
  await page.setContent(frame(p));
  await page.screenshot({ path: join(out, `og-${name}.png`) });
  console.log(`share/og-${name}.png`);
}
await browser.close();
