import { commandKind, type BridgeHistory, type BridgeSettings, type BridgeStatus, type CommandEntry, type Session, type SettingKey } from './status.js';

import { DEMO_KNOWLEDGE } from './demo-plugins.js';

// Fake bridge for `mcp_bridge.html?demo` — lets the UI be previewed without REAPER.

const COMMANDS: Array<[string, number, Record<string, unknown>]> = [
  ['list_tracks', 3, {}],
  ['get_track_properties', 2, { trackIndex: 3 }],
  ['set_fx_parameter', 0.6, { trackIndex: 3, fxIndex: 0, paramIndex: 4, value: 0.42 }],
  ['set_multiple_fx_parameters', 4, { params: '[{"trackIndex":3,"fxIndex":0,"paramIndex":1,"value":0.3}]' }],
  ['read_track_meters', 1.2, { trackIndex: 0 }],
  ['read_track_lufs', 18, { trackIndex: 0, durationMs: 3000 }],
  ['read_track_spectrum', 35, { trackIndex: 5, fftSize: 4096 }],
  ['add_fx', 22, { trackIndex: 3, fxName: 'VST3: Pro-Q 3' }],
  ['set_track_property', 0.8, { trackIndex: 2, property: 'volume', value: -3.5 }],
  ['snapshot_save', 60, { name: 'before-vocal-chain' }],
  ['get_fx_parameters', 9, { trackIndex: 3, fxIndex: 0 }],
];

const ERRORS = [
  'FX "VST3: Pro-Q 4" not found on track 3. Installed match candidates: Pro-Q 3',
  'Track index 42 out of range (project has 18 tracks)',
  'Handler error: mcp_bridge.lua:2214: attempt to index a nil value (local \'item\')',
];

const BUCKET_MS = 10_000;

export interface Demo {
  tick(): { status: BridgeStatus; history: BridgeHistory };
  set(key: SettingKey, on: boolean): void;
}

export function createDemo(): Demo {
  const startedAt = Date.now() - 47 * 60_000;
  let n = 0;
  let errors = 0;
  let recent: CommandEntry[] = [];
  const buckets = new Map<number, [number, number, number, number, number]>();
  const settings: BridgeSettings = { paused: false, readonly: false, openOnStart: true };
  const sessions: Session[] = [
    { id: '4f1c2a9e-1b7d-4c55-9a51-7f0d3e2b8c10', dir: '/Users/you/Music/midnight-drive', client: 'claude-code', first: startedAt + 60_000, last: 0, commands: 0, errors: 0 },
    { id: '9b2e77d0-5c3a-4e8f-b1d2-2a6c9f4e0d31', dir: '/Users/you/Music/stems-prep', client: 'claude-code', first: startedAt + 20 * 60_000, last: 0, commands: 0, errors: 0 },
    { id: 'pid-48213', dir: '/Users/you/Workspace/mix-scripts', client: 'cursor', first: startedAt + 5 * 60_000, last: 0, commands: 0, errors: 0 },
  ];

  const push = (t: number) => {
    const [c, base, params] = COMMANDS[Math.floor(Math.random() * COMMANDS.length)];
    // The first session does most of the work; the third went quiet after ~25 minutes
    const r = Math.random();
    const session = t - startedAt > 25 * 60_000 && r > 0.75 ? sessions[1] : r > 0.9 && t - startedAt < 25 * 60_000 ? sessions[2] : sessions[0];
    let ok = Math.random() > 0.06;
    let e = ok ? undefined : ERRORS[Math.floor(Math.random() * ERRORS.length)];
    if (settings.paused) {
      ok = false;
      e = 'Paused by user in the MCP Bridge window. Ask the user to resume agent control.';
    } else if (settings.readonly && commandKind(c) === 'write') {
      ok = false;
      e = `Read-only mode is on in the MCP Bridge window: '${c}' would change the project. Ask the user to turn read-only off.`;
    }
    n += 1;
    if (!ok) errors += 1;
    const ms = ok || !settings.paused ? Math.round(base * (0.5 + Math.random() * 1.5) * 100) / 100 : 0.01;
    const entry: CommandEntry = { n, t, c, ms, ok, s: session.id, p: JSON.stringify(params) };
    if (e) entry.e = e;
    recent = [entry, ...recent].slice(0, 50);
    session.last = t;
    session.commands += 1;
    if (!ok) session.errors += 1;
    const id = Math.floor(t / BUCKET_MS);
    const b = buckets.get(id) ?? [id, 0, 0, 0, 0];
    b[1] += 1;
    if (!ok) b[2] += 1;
    if (ok && entry.ms >= 100) b[3] += 1;
    b[4] += entry.ms;
    buckets.set(id, b);
  };

  // Seed the last 47 minutes with bursty agent sessions separated by quiet stretches
  for (let t = startedAt; t < Date.now(); t += 1000) {
    const minute = Math.floor((t - startedAt) / 60_000);
    const busy = minute % 9 < 4 || minute > 40;
    const rate = busy ? 0.25 + 0.45 * Math.abs(Math.sin(minute)) : 0.02;
    if (Math.random() < rate) push(t);
  }
  sessions[2].ended = true;

  return {
    tick() {
      if (Math.random() < 0.35) push(Date.now());
      // Idle agents still ping every 20s
      sessions[1].last = Math.max(sessions[1].last, Date.now() - 8000);
      return {
        status: {
          v: 1,
          ts: Date.now(),
          startedAt,
          reaperVersion: '7.27/macOS-arm64',
          project: 'Midnight Drive — mix v3.rpp',
          bridgeDir: '/Users/you/Library/Application Support/REAPER/Scripts/mcp_bridge_data/',
          commands: n,
          errors,
          deferMs: 33 + Math.random() * 2,
          recent,
          sessions: [...sessions].sort((a, b) => b.last - a.last),
          settings: { ...settings },
          health: { sws: true, jsfx: true, outdated: new URLSearchParams(location.search).has('outdated') },
          knowledge: DEMO_KNOWLEDGE,
        },
        history: { v: 1, size: BUCKET_MS, b: [...buckets.values()].sort((a, b) => a[0] - b[0]) },
      };
    },
    set(key, on) {
      if (key === 'cfg_paused') settings.paused = on;
      else if (key === 'cfg_readonly') settings.readonly = on;
      else settings.openOnStart = on;
    },
  };
}
