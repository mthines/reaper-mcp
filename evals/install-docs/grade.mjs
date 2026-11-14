// Pure grading for the install-docs eval: no I/O, so grade.test.mjs can drive it with fixed inputs.
//
// Two inputs:
//   - the agent's transcript (Claude Code `--output-format stream-json` lines), read with parseTranscript()
//   - facts about the sandbox machine after the run (what is installed where), collected by run.mjs
// grade() turns them into checks: OUTCOME checks (did the machine end up set up?) weigh twice as much as
// PROCESS checks (did the agent get there the way the guide says, and hand the human steps back?).

/** Every check, in report order. `kind` decides the weight; the default required set is in DEFAULT_REQUIRED. */
export const CHECKS = [
  { id: 'cli_installed', kind: 'outcome', label: '`reaper-mcp` is installed (npm global)' },
  { id: 'bridge_installed', kind: 'outcome', label: 'The bridge is in REAPER/Scripts' },
  { id: 'autostart', kind: 'outcome', label: "The bridge starts with REAPER (__startup.lua block)" },
  { id: 'web_interface', kind: 'outcome', label: "REAPER's web interface serves the status page (reaper.ini)" },
  { id: 'claude_registered', kind: 'outcome', label: 'Claude Code lists the reaper server from another folder' },
  { id: 'skills_installed', kind: 'outcome', label: 'The mix skills are in ~/.claude/skills' },
  { id: 'documented_commands', kind: 'process', label: 'Ran the three documented commands (install, setup, init)' },
  { id: 'no_manual_config', kind: 'process', label: 'Did not hand-edit configs or register the server itself' },
  { id: 'no_clone', kind: 'process', label: 'Did not clone the repo (the guide says no cloning)' },
  { id: 'no_sudo', kind: 'process', label: 'Did not use sudo' },
  { id: 'handoff_reaper', kind: 'process', label: 'Told the user to start or restart REAPER' },
  { id: 'handoff_verify', kind: 'process', label: 'Told the user how to check it is connected' },
];

export const DEFAULT_REQUIRED = ['cli_installed', 'bridge_installed', 'claude_registered', 'skills_installed', 'handoff_reaper'];

const WEIGHT = { outcome: 2, process: 1 };

/** Config files the CLI owns: an agent editing one by hand means the guide's commands did not get it there. */
const MANAGED_FILES = /(\.claude\.json|\.mcp\.json|\/\.claude\/settings\.json|\/\.cursor\/mcp\.json|\/\.codex\/config\.toml|\/\.gemini\/settings\.json|reaper\.ini|__startup\.lua|mcp_bridge\.lua)$/;

/** Read stream-json lines into the parts grading needs. Unparseable lines are counted, never fatal. */
export function parseTranscript(text) {
  const toolCalls = [];
  const toolResults = [];
  let result = null;
  let model = null;
  let badLines = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    if (ev.type === 'system' && ev.subtype === 'init') model = ev.model ?? model;
    if (ev.type === 'assistant') {
      for (const block of ev.message?.content ?? []) {
        if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: block.input ?? {} });
      }
    }
    if (ev.type === 'user') {
      const content = ev.message?.content;
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type === 'tool_result') toolResults.push({ id: block.tool_use_id, isError: Boolean(block.is_error) });
      }
    }
    if (ev.type === 'result') result = ev;
  }
  const bashCommands = toolCalls.filter((c) => c.name === 'Bash').map((c) => String(c.input.command ?? ''));
  const docsRead = toolCalls
    .filter((c) => c.name === 'WebFetch' || c.name === 'Read')
    .map((c) => String(c.input.url ?? c.input.file_path ?? ''))
    .filter(Boolean);
  const edits = toolCalls
    .filter((c) => ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(c.name))
    .map((c) => String(c.input.file_path ?? c.input.notebook_path ?? ''));
  return {
    model,
    toolCalls,
    bashCommands,
    docsRead,
    edits,
    toolErrors: toolResults.filter((r) => r.isError).length,
    finalText: typeof result?.result === 'string' ? result.result : '',
    finished: result ? result.subtype === 'success' && !result.is_error : false,
    stopReason: result?.subtype ?? 'no_result',
    numTurns: result?.num_turns ?? null,
    costUsd: result?.total_cost_usd ?? null,
    durationMs: result?.duration_ms ?? null,
    badLines,
  };
}

const ran = (cmds, re) => cmds.some((c) => re.test(c));

/** Did the agent hand REAPER back to the user? It cannot start REAPER itself, so the guide's step 2 is theirs. */
export function mentionsStartReaper(text) {
  return (
    /\b(start|restart|re-start|open|launch|relaunch|reopen|quit)\w*\b[^.\n]{0,60}\bREAPER\b/i.test(text) ||
    /\bREAPER\b[^.\n]{0,60}\b(start|restart|open|launch|relaunch|reopen)\w*/i.test(text) ||
    /mcp_bridge\.lua/i.test(text)
  );
}

/** How to see it worked: `/mcp`, the status window's light, asking for the tempo, or doctor. */
export function mentionsVerify(text) {
  return /(^|\s|`)\/mcp\b|status window|green light|tempo|reaper-mcp doctor|`doctor`/i.test(text);
}

/**
 * @param {object} facts   from run.mjs: { cliInstalled, bridgeInstalled, autostart, webInterface, claudeRegistered, skillsInstalled, mcpListLine }
 * @param {ReturnType<typeof parseTranscript>} t
 * @param {{ required?: string[], skip?: string[] }} scenario  `skip`: checks that do not apply (left out of the score)
 */
export function grade(facts, t, scenario = {}) {
  const cmds = t.bashCommands;
  const installed = ran(cmds, /\bnpm\s+(install|i|add)\b[^\n;&|]*(-g\b|--global\b)[^\n;&|]*@mthines\/reaper-mcp|\bnpm\s+(install|i|add)\b[^\n;&|]*@mthines\/reaper-mcp[^\n;&|]*(-g\b|--global\b)/);
  const setup = ran(cmds, /\breaper-mcp\s+setup\b(?!-sidecar)/);
  // `setup --yes` runs init (and doctor) itself, so it counts for both
  const init = ran(cmds, /\breaper-mcp\s+init\b/) || ran(cmds, /\breaper-mcp\s+setup\b[^\n;&|]*\s(--yes|-y)\b/);
  const manualRegister = ran(cmds, /\b(claude|codex|gemini)\s+mcp\s+add\b[^\n]*\breaper\b/);
  const editedManaged = t.edits.filter((p) => MANAGED_FILES.test(p));
  // `sed -i`/`echo >>` on a managed file counts as a hand edit too
  const shellEdited = cmds.filter((c) => /(\bsed\s+-i|>>?|\btee\b)[^\n]*(\.claude\.json|reaper\.ini|__startup\.lua|\.mcp\.json)/.test(c));

  const results = {
    cli_installed: [facts.cliInstalled, facts.cliInstalled ? '' : 'no reaper-mcp in the npm global bin'],
    bridge_installed: [facts.bridgeInstalled, facts.bridgeInstalled ? '' : 'Scripts/mcp_bridge.lua missing'],
    autostart: [facts.autostart, facts.autostart ? '' : 'no startup block in Scripts/__startup.lua'],
    web_interface: [facts.webInterface, facts.webInterface ? '' : 'no HTTP control surface for mcp_bridge.html in reaper.ini'],
    claude_registered: [facts.claudeRegistered, facts.mcpListLine || 'reaper not in `claude mcp list`'],
    skills_installed: [facts.skillsInstalled, facts.skillsInstalled ? '' : '~/.claude/skills/mixer/SKILL.md missing'],
    documented_commands: [
      installed && setup && init,
      [!installed && 'no `npm install -g @mthines/reaper-mcp`', !setup && 'no `reaper-mcp setup`', !init && 'no `reaper-mcp init`'].filter(Boolean).join('; '),
    ],
    no_manual_config: [
      !manualRegister && editedManaged.length === 0 && shellEdited.length === 0,
      [manualRegister && 'ran `mcp add` itself', ...editedManaged.map((p) => `edited ${p}`), ...shellEdited.map((c) => `shell-edited: ${c.slice(0, 80)}`)]
        .filter(Boolean)
        .join('; '),
    ],
    no_clone: [!ran(cmds, /\bgit\s+clone\b/), ran(cmds, /\bgit\s+clone\b/) ? 'ran git clone' : ''],
    no_sudo: [!ran(cmds, /(^|[;&|\s])sudo\s/), ran(cmds, /(^|[;&|\s])sudo\s/) ? 'used sudo' : ''],
    handoff_reaper: [mentionsStartReaper(t.finalText), t.finalText ? '' : 'no final message'],
    handoff_verify: [mentionsVerify(t.finalText), ''],
  };

  const required = new Set(scenario.required ?? DEFAULT_REQUIRED);
  const skip = new Set(scenario.skip ?? []);
  const checks = CHECKS.filter((c) => !skip.has(c.id)).map((c) => {
    const [pass, detail] = results[c.id];
    return { ...c, pass: Boolean(pass), detail: pass ? '' : detail, required: required.has(c.id), weight: WEIGHT[c.kind] };
  });
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.pass ? c.weight : 0), 0);
  return {
    checks,
    score: Math.round((got / total) * 100),
    passed: checks.every((c) => !c.required || c.pass),
  };
}

const mean = (xs) => {
  const ns = xs.filter((x) => typeof x === 'number');
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
};

/** Roll runs up per scenario: pass rate, mean score, effort, and how often each check passed. */
export function summarise(runs) {
  const byScenario = new Map();
  for (const r of runs) {
    if (!byScenario.has(r.scenario)) byScenario.set(r.scenario, []);
    byScenario.get(r.scenario).push(r);
  }
  return [...byScenario].map(([scenario, rs]) => ({
    scenario,
    runs: rs.length,
    passRate: rs.filter((r) => r.grade.passed).length / rs.length,
    meanScore: mean(rs.map((r) => r.grade.score)),
    meanTurns: mean(rs.map((r) => r.transcript.numTurns)),
    meanToolCalls: mean(rs.map((r) => r.transcript.toolCalls.length)),
    meanToolErrors: mean(rs.map((r) => r.transcript.toolErrors)),
    meanCostUsd: mean(rs.map((r) => r.transcript.costUsd)),
    meanDurationS: mean(rs.map((r) => (r.transcript.durationMs ?? r.wallMs) / 1000)),
    // null = the check does not apply to this scenario
    checkPassRate: Object.fromEntries(
      CHECKS.map((c) => {
        const graded = rs.map((r) => r.grade.checks.find((x) => x.id === c.id)).filter(Boolean);
        return [c.id, graded.length ? graded.filter((x) => x.pass).length / graded.length : null];
      }),
    ),
  }));
}

const pct = (x) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);
const num = (x, d = 1) => (x == null ? '–' : x.toFixed(d));

/** The Markdown report: one table per run set, then each check's pass rate per scenario, then each run's misses. */
export function renderSummary(runs, meta) {
  const sum = summarise(runs);
  const lines = [
    `# Install-docs eval — ${meta.stamp}`,
    '',
    `Docs: **${meta.docs}** · package: **${meta.package}** · model: **${meta.model ?? 'default'}** · runs per scenario: **${meta.runs}**`,
    '',
    '| Scenario | Pass | Score | Turns | Tool calls | Tool errors | Cost (USD) | Time (s) |',
    '|---|---|---|---|---|---|---|---|',
    ...sum.map((s) => `| ${s.scenario} | ${pct(s.passRate)} | ${num(s.meanScore, 0)} | ${num(s.meanTurns)} | ${num(s.meanToolCalls)} | ${num(s.meanToolErrors)} | ${num(s.meanCostUsd, 2)} | ${num(s.meanDurationS, 0)} |`),
    '',
    '## Checks',
    '',
    `| Check | ${sum.map((s) => s.scenario).join(' | ')} |`,
    `|---|${sum.map(() => '---').join('|')}|`,
    ...CHECKS.map((c) => `| ${c.label} (${c.kind}) | ${sum.map((s) => pct(s.checkPassRate[c.id])).join(' | ')} |`),
    '',
    '## Runs',
    '',
  ];
  for (const r of runs) {
    const misses = r.grade.checks.filter((c) => !c.pass);
    lines.push(`### ${r.scenario} #${r.run} — ${r.grade.passed ? 'PASS' : 'FAIL'}, score ${r.grade.score}`);
    lines.push('');
    lines.push(`Stop: ${r.transcript.stopReason} · docs read: ${r.transcript.docsRead.length ? r.transcript.docsRead.map((d) => `\`${d}\``).join(', ') : 'none'}`);
    lines.push('');
    for (const c of misses) lines.push(`- ✗ ${c.required ? '**required** ' : ''}${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
    if (!misses.length) lines.push('- every check passed');
    lines.push('');
    lines.push('<details><summary>Commands the agent ran</summary>', '', '```bash', ...r.transcript.bashCommands, '```', '', '</details>', '');
  }
  return lines.join('\n');
}
