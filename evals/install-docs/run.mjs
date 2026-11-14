#!/usr/bin/env node
// Install-docs eval: how far does an agent get when the user just points it at the setup guide?
//
//   node evals/install-docs/run.mjs [--scenario id,id] [--runs N] [--docs local|live] [--package local|registry]
//                                   [--model M] [--budget USD] [--timeout MIN] [--keep] [--no-build] [--dry-run] [--baseline]
//
// Each run builds a fresh machine in a temp folder (empty HOME, a REAPER resource folder at the platform's default
// place, node/npm/git/claude on PATH, a pgrep that never finds REAPER), then runs Claude Code headless in it
// (`claude -p`, permissions bypassed, stream-json transcript) with a scenario's prompt, like "set this up, here's the
// guide". Afterwards it checks what is actually installed and grades the transcript (grade.mjs). Results go to
// evals/install-docs/results/<stamp>/ (summary.md, summary.json, and per run the transcript and the facts).
//
// --docs local (default) hands the agent this working tree's docs/guides as files, so you can measure a docs change
// before it ships; --docs live points it at https://reaper-mcp.vercel.app/docs. --package local (default) builds the
// npm package from this working tree and makes `npm install -g @mthines/reaper-mcp` install that tarball (an `npm`
// shim swaps the name for the tarball, so the agent types exactly what the guide says); --package registry installs
// the published package. Needs ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token`): the agent runs
// with an empty HOME, so it has no login of its own.
//
// --baseline runs the guide's three commands exactly as written instead of an agent (no login needed), graded the
// same way: the control. If the baseline fails, the documented commands are broken, not the agent.
//
// The agent runs with permissions bypassed and HOME pointed at the sandbox, but it is still a process on this
// machine: run it in a VM or container if you do not want an agent with a shell on your computer.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grade, parseTranscript, renderSummary, summarise } from './grade.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const LIVE_DOCS = 'https://reaper-mcp.vercel.app/docs';
const AUTOSTART_MARKER = 'reaper-mcp: start the bridge with REAPER'; // cli.ts AUTOSTART_MARKER
const PKG_NAME = '@mthines/reaper-mcp';

// ── args ────────────────────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { runs: 1, docs: 'local', package: 'local', budget: 3, timeout: 20, build: true, keep: false, dryRun: false, baseline: false, scenarios: null, model: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--runs') o.runs = Number(val());
    else if (a === '--docs') o.docs = val();
    else if (a === '--package') o.package = val();
    else if (a === '--model') o.model = val();
    else if (a === '--budget') o.budget = Number(val());
    else if (a === '--timeout') o.timeout = Number(val());
    else if (a === '--scenario') o.scenarios = val().split(',');
    else if (a === '--keep') o.keep = true;
    else if (a === '--no-build') o.build = false;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--baseline') o.baseline = true;
    else if (a === '-h' || a === '--help') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf-8').split('\n').slice(1, 24).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(0);
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (!['local', 'live'].includes(o.docs)) throw new Error('--docs is local or live');
  if (!['local', 'registry'].includes(o.package)) throw new Error('--package is local or registry');
  if (!(o.runs >= 1)) throw new Error('--runs must be 1 or more');
  return o;
}

const which = (bin) => {
  const r = spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf-8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** Run a build step quietly; its output is shown only when it fails. */
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}):\n${(r.stdout ?? '') + (r.stderr ?? '')}`.slice(-4000));
};

// ── the package under test ──────────────────────────────────────────────────────────────────────────────────────
/** Build the server and status page from this working tree, assemble the npm package and pack it. Returns the tarball. */
function packLocal(outDir, build) {
  if (build) {
    console.log('==> Building the server and status page');
    sh('pnpm', ['nx', 'run-many', '--target=build', '--projects=reaper-mcp-server,bridge-ui'], { cwd: root, env: { ...process.env, NX_NO_CLOUD: 'true' } });
  }
  sh('node', ['scripts/prepare-npm-package.mjs'], { cwd: root });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync('npm', ['pack', join(root, 'dist', 'apps', 'reaper-mcp-server'), '--pack-destination', outDir], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`npm pack failed:\n${r.stderr}`);
  const tgz = readdirSync(outDir).find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error('npm pack wrote no tarball');
  return join(outDir, tgz);
}

// ── the docs the agent is pointed at ────────────────────────────────────────────────────────────────────────────
const frontmatter = (text) => Object.fromEntries([...(text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '').matchAll(/^(\w+):\s*(.*)$/gm)].map((m) => [m[1], m[2].trim()]));

/** Copy the guides into the sandbox with an index.md standing in for the hosted /docs page. */
function copyLocalDocs(dest) {
  const src = join(root, 'docs', 'guides');
  cpSync(src, dest, { recursive: true, filter: (p) => !['README.md', 'CLAUDE.md'].includes(basename(p)) || dirname(p) !== src });
  const sections = { start: 'Get started', safe: 'Stay safe', try: 'Try it', know: 'Good to know' };
  const pages = readdirSync(dest)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ f, ...frontmatter(readFileSync(join(dest, f), 'utf-8')) }))
    .filter((p) => p.title);
  const index = ['# reaper-mcp docs', '', 'Guides for musicians. Start at the top.', ''];
  for (const [key, name] of Object.entries(sections)) {
    index.push(`## ${name}`, '');
    for (const p of pages.filter((x) => x.section === key).sort((a, b) => Number(a.order) - Number(b.order))) index.push(`- [${p.title}](${p.f}): ${p.summary ?? ''}`);
    index.push('');
  }
  writeFileSync(join(dest, 'index.md'), index.join('\n'));
}

function resolvePrompt(template, docs) {
  return template
    .replace(/\{docs\}/g, docs.mode === 'live' ? LIVE_DOCS : join(docs.dir, 'index.md'))
    .replace(/\{page:([\w-]+)\}/g, (_m, slug) => (docs.mode === 'live' ? `${LIVE_DOCS}/${slug}` : join(docs.dir, `${slug}.md`)));
}

// ── one machine ─────────────────────────────────────────────────────────────────────────────────────────────────
function reaperFolder(home) {
  if (platform() === 'darwin') return join(home, 'Library', 'Application Support', 'REAPER');
  if (platform() === 'win32') return join(home, 'AppData', 'Roaming', 'REAPER');
  return join(home, '.config', 'REAPER');
}

/** Rewrites the package name to the local tarball for install-like npm/npx calls, then runs the real one. */
function shim(real, tarball, onlyInstall) {
  const guard = onlyInstall ? 'case "$1" in install|i|add|update|up|upgrade) ;; *) exec "$REAL" "$@";; esac\n' : '';
  return `#!/bin/sh
REAL=${JSON.stringify(real)}
${guard}for a do
  shift
  case "$a" in ${PKG_NAME}|${PKG_NAME}@*) a=${JSON.stringify(tarball)};; esac
  set -- "$@" "$a"
done
exec "$REAL" "$@"
`;
}

function makeMachine(dir, { tarball, reaperIni, docsMode }) {
  // Physical path: the CLI shortens "$HOME/…" to "~/…" by string match
  const sandbox = realpathSync(dir);
  const home = join(sandbox, 'home');
  const bin = join(sandbox, 'bin');
  const prefix = join(sandbox, 'npm-global');
  const reaper = reaperFolder(home);
  for (const d of [join(home, 'Music'), bin, join(prefix, 'bin'), reaper]) mkdirSync(d, { recursive: true });
  if (reaperIni) writeFileSync(join(reaper, 'reaper.ini'), '[REAPER]\n');

  // What a fresh machine with Node.js and Claude Code has. Only these, never node's folder: an earlier global
  // install there (codex, gemini) would make init find harnesses this machine does not have.
  for (const b of ['node', 'git', 'claude']) {
    const p = which(b);
    if (!p) throw new Error(`missing on PATH: ${b}`);
    symlinkSync(p, join(bin, b));
  }
  for (const b of ['npm', 'npx']) {
    const real = which(b);
    if (!real) throw new Error(`missing on PATH: ${b}`);
    if (tarball) {
      writeFileSync(join(bin, b), shim(real, tarball, b === 'npm'));
      chmodSync(join(bin, b), 0o755);
    } else symlinkSync(real, join(bin, b));
  }
  // A pgrep that finds nothing: a REAPER running on this computer must not make setup wait for it to quit
  writeFileSync(join(bin, 'pgrep'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(bin, 'pgrep'), 0o755);

  let docsDir = null;
  if (docsMode === 'local') {
    docsDir = join(home, 'Downloads', 'reaper-mcp-docs');
    copyLocalDocs(docsDir);
  }

  const pass = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'TERM', 'LANG', 'TMPDIR'];
  const env = {
    ...Object.fromEntries(pass.filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
    HOME: home,
    USER: process.env.USER ?? 'eval',
    PATH: [bin, join(prefix, 'bin'), '/usr/bin', '/bin'].join(':'),
    NPM_CONFIG_PREFIX: prefix,
    // Shared download cache: deps are fetched once, not per run (it holds packages, not config)
    NPM_CONFIG_CACHE: join(homedir(), '.npm'),
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    REAPER_MCP_TELEMETRY: '0', // eval runs must not count as real installs
  };
  // Claude Code refuses to skip permissions as root unless it is told it is in a sandbox
  if (process.getuid?.() === 0) env.IS_SANDBOX = '1';
  return { sandbox, home, bin, prefix, reaper, env, docsDir, cwd: join(home, 'Music') };
}

/** What is on the machine now: the outcome half of the grade. */
function collectFacts(m) {
  const cli = join(m.prefix, 'bin', 'reaper-mcp');
  const read = (p) => (existsSync(p) ? readFileSync(p, 'utf-8') : '');
  const ini = read(join(m.reaper, 'reaper.ini'));
  const startup = read(join(m.reaper, 'Scripts', '__startup.lua'));
  const opts = { cwd: m.cwd, env: m.env, encoding: 'utf-8', timeout: 90_000 };
  const list = spawnSync('claude', ['mcp', 'list'], opts);
  const mcpList = `${list.stdout ?? ''}${list.stderr ?? ''}`;
  const mcpListLine = mcpList.split('\n').find((l) => /^reaper:/.test(l.trim()))?.trim() ?? '';
  const doctor = existsSync(cli) ? spawnSync(cli, ['doctor'], opts) : null;
  return {
    cliInstalled: existsSync(cli),
    bridgeInstalled: existsSync(join(m.reaper, 'Scripts', 'mcp_bridge.lua')) || existsSync(join(m.reaper, 'Scripts', 'reaper-mcp', 'MCP Bridge', 'mcp_bridge.lua')),
    autostart: startup.includes(AUTOSTART_MARKER),
    webInterface: /^csurf_\d+=HTTP .*mcp_bridge\.html/m.test(ini),
    claudeRegistered: Boolean(mcpListLine),
    mcpListLine,
    mcpList,
    skillsInstalled: existsSync(join(m.home, '.claude', 'skills', 'mixer', 'SKILL.md')),
    doctor: doctor ? `${doctor.stdout ?? ''}${doctor.stderr ?? ''}` : '(reaper-mcp not installed)',
  };
}

/** Run Claude Code headless in the machine; resolves with the raw transcript. */
function runAgent(m, prompt, o, outDir) {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--no-session-persistence', '--max-budget-usd', String(o.budget)];
  if (o.model) args.push('--model', o.model);
  return new Promise((resolveRun) => {
    const started = Date.now();
    const child = spawn('claude', args, { cwd: m.cwd, env: m.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let timedOut = false;
    child.stdout.on('data', (d) => {
      out += d;
      // One dot per tool call, so a long run shows it is alive
      for (const _ of String(d).matchAll(/"type":"tool_use"/g)) process.stdout.write('.');
    });
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, o.timeout * 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      process.stdout.write('\n');
      writeFileSync(join(outDir, 'transcript.jsonl'), out);
      writeFileSync(join(outDir, 'agent-stderr.txt'), err);
      resolveRun({ out, code, timedOut, wallMs: Date.now() - started });
    });
  });
}

/** The control: the guide's commands typed verbatim, written as a transcript grade() reads like an agent's. */
const BASELINE_COMMANDS = ['npm install -g @mthines/reaper-mcp', 'reaper-mcp setup', 'reaper-mcp init'];
const BASELINE_HANDOFF = 'Installed. Start REAPER (or restart it), then run `claude` and type /mcp to check reaper is connected.';

function runBaseline(m, outDir) {
  const started = Date.now();
  const lines = [JSON.stringify({ type: 'system', subtype: 'init', model: 'baseline' })];
  let log = '';
  for (const [i, command] of BASELINE_COMMANDS.entries()) {
    const r = spawnSync('sh', ['-c', command], { cwd: m.cwd, env: m.env, encoding: 'utf-8', timeout: 10 * 60_000 });
    log += `$ ${command}\n${r.stdout ?? ''}${r.stderr ?? ''}\n(exit ${r.status})\n\n`;
    lines.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `b${i}`, name: 'Bash', input: { command } }] } }));
    lines.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `b${i}`, is_error: r.status !== 0 }] } }));
  }
  const durationMs = Date.now() - started;
  lines.push(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: BASELINE_HANDOFF, num_turns: BASELINE_COMMANDS.length, total_cost_usd: 0, duration_ms: durationMs }));
  const out = lines.join('\n');
  writeFileSync(join(outDir, 'transcript.jsonl'), out);
  writeFileSync(join(outDir, 'baseline-output.txt'), log);
  return { out, code: 0, timedOut: false, wallMs: durationMs };
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const o = parseArgs(process.argv.slice(2));
  const all = JSON.parse(readFileSync(join(here, 'scenarios.json'), 'utf-8'));
  const unknown = (o.scenarios ?? []).filter((id) => !all.some((s) => s.id === id));
  if (unknown.length) throw new Error(`unknown scenario: ${unknown.join(', ')} (have: ${all.map((s) => s.id).join(', ')})`);
  const scenarios = o.scenarios ? all.filter((s) => o.scenarios.includes(s.id)) : all.filter((s) => !s.optIn);

  if (o.dryRun) {
    for (const s of scenarios) console.log(`${s.id}: ${resolvePrompt(s.prompt, { mode: o.docs, dir: '<sandbox>/home/Downloads/reaper-mcp-docs' })}`);
    return;
  }
  if (!o.baseline && !process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    throw new Error('Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`): the agent runs with an empty HOME, so it has no login.');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outRoot = join(here, 'results', stamp);
  mkdirSync(outRoot, { recursive: true });
  const tarball = o.package === 'local' ? packLocal(join(outRoot, 'package'), o.build) : null;

  const runs = [];
  for (const s of scenarios) {
    for (let run = 1; run <= o.runs; run++) {
      const outDir = join(outRoot, `${s.id}-${run}`);
      mkdirSync(outDir, { recursive: true });
      const m = makeMachine(mkdtempSync(join(tmpdir(), 'reaper-mcp-eval-')), { tarball, reaperIni: s.reaperIni !== false, docsMode: o.docs });
      const prompt = resolvePrompt(s.prompt, { mode: o.docs, dir: m.docsDir });
      console.log(`==> ${s.id} #${run}: ${prompt}`);
      try {
        const agent = o.baseline ? runBaseline(m, outDir) : await runAgent(m, prompt, o, outDir);
        const facts = collectFacts(m);
        const transcript = parseTranscript(agent.out);
        if (agent.timedOut) transcript.stopReason = 'timeout';
        const g = grade(facts, transcript, s);
        writeFileSync(join(outDir, 'facts.json'), JSON.stringify(facts, null, 2));
        writeFileSync(join(outDir, 'grade.json'), JSON.stringify(g, null, 2));
        runs.push({ scenario: s.id, run, prompt, wallMs: agent.wallMs, grade: g, transcript });
        console.log(`    ${g.passed ? 'PASS' : 'FAIL'} · score ${g.score} · ${transcript.numTurns ?? '?'} turns · $${transcript.costUsd?.toFixed(2) ?? '?'} · ${transcript.stopReason}`);
        if (!transcript.finalText && agent.code !== 0) console.log(`    agent exited ${agent.code}; see ${join(outDir, 'agent-stderr.txt')}`);
      } finally {
        if (o.keep) console.log(`    sandbox kept: ${m.sandbox}`);
        else rmSync(m.sandbox, { recursive: true, force: true });
      }
    }
  }

  const meta = { stamp, docs: o.baseline ? 'n/a (baseline)' : o.docs, package: o.package, model: o.model ?? runs.find((r) => r.transcript.model)?.transcript.model, runs: o.runs };
  writeFileSync(join(outRoot, 'summary.md'), renderSummary(runs, meta));
  writeFileSync(
    join(outRoot, 'summary.json'),
    JSON.stringify({ meta, scenarios: summarise(runs), runs: runs.map(({ transcript, ...r }) => ({ ...r, transcript: { ...transcript, toolCalls: transcript.toolCalls.length } })) }, null, 2),
  );
  console.log(`\n${renderSummary(runs, meta).split('\n## Checks')[0]}`);
  console.log(`Full report: ${join(outRoot, 'summary.md')}`);
  if (runs.some((r) => !r.grade.passed)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(2);
});
