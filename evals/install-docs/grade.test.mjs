// node --test evals/install-docs/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grade, mentionsStartReaper, parseTranscript, renderSummary, summarise } from './grade.mjs';

const line = (o) => JSON.stringify(o);
const bash = (id, command) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
const toolResult = (id, isError = false) => line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] } });
const result = (text, extra = {}) => line({ type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 9, total_cost_usd: 0.41, duration_ms: 90_000, ...extra });

const GOOD = [
  line({ type: 'system', subtype: 'init', model: 'claude-test' }),
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'w', name: 'WebFetch', input: { url: 'https://reaper-mcp.vercel.app/docs/install' } }] } }),
  bash('a', 'npm install -g @mthines/reaper-mcp'),
  toolResult('a'),
  bash('b', 'reaper-mcp setup'),
  toolResult('b'),
  bash('c', 'reaper-mcp init'),
  toolResult('c', true),
  result('Done. Now start REAPER (or restart it), then run `claude` and type /mcp to check reaper is listed.'),
].join('\n');

const ALL_FACTS = { cliInstalled: true, bridgeInstalled: true, autostart: true, webInterface: true, claudeRegistered: true, skillsInstalled: true, mcpListLine: 'reaper: node … - ✓ Connected' };

test('reads commands, docs, errors and the result from a stream-json transcript', () => {
  const t = parseTranscript(`${GOOD}\nnot json`);
  assert.deepEqual(t.bashCommands, ['npm install -g @mthines/reaper-mcp', 'reaper-mcp setup', 'reaper-mcp init']);
  assert.deepEqual(t.docsRead, ['https://reaper-mcp.vercel.app/docs/install']);
  assert.equal(t.toolErrors, 1);
  assert.equal(t.numTurns, 9);
  assert.equal(t.model, 'claude-test');
  assert.equal(t.finished, true);
  assert.equal(t.badLines, 1);
});

test('a run that follows the guide and hands REAPER back passes with a full score', () => {
  const g = grade(ALL_FACTS, parseTranscript(GOOD));
  assert.equal(g.passed, true);
  assert.equal(g.score, 100);
});

test('a missing required outcome fails the run even when everything else passed', () => {
  const g = grade({ ...ALL_FACTS, claudeRegistered: false, mcpListLine: '' }, parseTranscript(GOOD));
  assert.equal(g.passed, false);
  assert.match(g.checks.find((c) => c.id === 'claude_registered').detail, /not in `claude mcp list`/);
  assert.ok(g.score < 100);
});

test('registering the server by hand or editing a managed file is flagged', () => {
  const t = parseTranscript(
    [
      bash('a', 'npm i -g @mthines/reaper-mcp && reaper-mcp setup'),
      bash('b', 'claude mcp add --scope user reaper -- node /x/main.js serve'),
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'e', name: 'Edit', input: { file_path: '/h/.config/REAPER/reaper.ini' } }] } }),
      result('Restart REAPER.'),
    ].join('\n'),
  );
  const c = grade(ALL_FACTS, t).checks;
  const manual = c.find((x) => x.id === 'no_manual_config');
  assert.equal(manual.pass, false);
  assert.match(manual.detail, /mcp add/);
  assert.match(manual.detail, /reaper\.ini/);
  assert.equal(c.find((x) => x.id === 'documented_commands').pass, false, 'init was never run');
});

test('`setup --yes` counts as running init, since it runs init itself', () => {
  const t = parseTranscript([bash('a', 'npm install --global @mthines/reaper-mcp'), bash('b', 'reaper-mcp setup --yes'), result('Open REAPER.')].join('\n'));
  assert.equal(grade(ALL_FACTS, t).checks.find((x) => x.id === 'documented_commands').pass, true);
});

test('setup-sidecar is not mistaken for setup', () => {
  const t = parseTranscript([bash('a', 'npm install -g @mthines/reaper-mcp'), bash('b', 'reaper-mcp setup-sidecar'), bash('c', 'reaper-mcp init'), result('')].join('\n'));
  assert.match(grade(ALL_FACTS, t).checks.find((x) => x.id === 'documented_commands').detail, /no `reaper-mcp setup`/);
});

test('cloning and sudo are flagged', () => {
  const t = parseTranscript([bash('a', 'git clone https://github.com/mthines/reaper-mcp.git'), bash('b', 'sudo npm install -g @mthines/reaper-mcp'), result('')].join('\n'));
  const c = grade(ALL_FACTS, t).checks;
  assert.equal(c.find((x) => x.id === 'no_clone').pass, false);
  assert.equal(c.find((x) => x.id === 'no_sudo').pass, false);
});

test('the hand-off check needs REAPER started by the user, not just named', () => {
  assert.equal(mentionsStartReaper('Restart REAPER so the bridge loads.'), true);
  assert.equal(mentionsStartReaper('Open REAPER and look for the status window.'), true);
  assert.equal(mentionsStartReaper('Once REAPER is launched, run /mcp.'), true);
  assert.equal(mentionsStartReaper('Run mcp_bridge.lua from the action list.'), true);
  assert.equal(mentionsStartReaper('reaper-mcp is installed for REAPER.'), false);
});

test('a skipped check is left out of the score and the summary shows it as n/a', () => {
  const t = parseTranscript([bash('a', 'git clone https://github.com/mthines/reaper-mcp.git && cd reaper-mcp && ./scripts/install.sh'), result('Start REAPER, then /mcp.')].join('\n'));
  const scenario = { skip: ['cli_installed', 'documented_commands', 'no_clone'], required: ['bridge_installed'] };
  const g = grade({ ...ALL_FACTS, cliInstalled: false }, t, scenario);
  assert.equal(g.checks.some((c) => c.id === 'no_clone'), false);
  assert.equal(g.passed, true);
  assert.equal(g.score, 100);
  const run = { scenario: 'github-readme', run: 1, wallMs: 1, grade: g, transcript: t };
  assert.equal(summarise([run])[0].checkPassRate.no_clone, null);
  assert.match(renderSummary([run], { stamp: 's', docs: 'live', package: 'registry', runs: 1 }), /n\/a/);
});

test('summarise rolls runs up per scenario', () => {
  const t = parseTranscript(GOOD);
  const pass = { scenario: 'install-guide', run: 1, wallMs: 1, grade: grade(ALL_FACTS, t), transcript: t };
  const fail = { scenario: 'install-guide', run: 2, wallMs: 1, grade: grade({ ...ALL_FACTS, bridgeInstalled: false }, t), transcript: t };
  const [s] = summarise([pass, fail]);
  assert.equal(s.runs, 2);
  assert.equal(s.passRate, 0.5);
  assert.equal(s.checkPassRate.bridge_installed, 0.5);
  assert.equal(s.meanTurns, 9);
});
