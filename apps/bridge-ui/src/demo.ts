import type { BridgeStatus, CommandEntry } from './status.js';

// Fake bridge for `mcp_bridge.html?demo` — lets the UI be previewed without REAPER.

const COMMANDS: Array<[string, number]> = [
  ['list_tracks', 3],
  ['get_track_properties', 2],
  ['set_fx_parameter', 0.6],
  ['set_multiple_fx_parameters', 4],
  ['read_track_meters', 1.2],
  ['read_track_lufs', 18],
  ['read_track_spectrum', 35],
  ['add_fx', 22],
  ['set_track_property', 0.8],
  ['snapshot_save', 60],
  ['get_fx_parameters', 9],
];

const ERRORS = [
  'FX "VST3: Pro-Q 4" not found on track 3. Installed match candidates: Pro-Q 3',
  'Track index 42 out of range (project has 18 tracks)',
  'Handler error: mcp_bridge.lua:2214: attempt to index a nil value (local \'item\')',
];

export function createDemo(): () => BridgeStatus {
  const startedAt = Date.now() - 47 * 60_000;
  let n = 0;
  let errors = 0;
  let recent: CommandEntry[] = [];

  const push = (t: number) => {
    const [c, base] = COMMANDS[Math.floor(Math.random() * COMMANDS.length)];
    const ok = Math.random() > 0.06;
    n += 1;
    if (!ok) errors += 1;
    const entry: CommandEntry = { n, t, c, ms: Math.round(base * (0.5 + Math.random() * 1.5) * 100) / 100, ok };
    if (!ok) entry.e = ERRORS[Math.floor(Math.random() * ERRORS.length)];
    recent = [entry, ...recent].slice(0, 50);
  };

  for (let i = 40; i > 0; i--) push(Date.now() - i * 1700);

  return () => {
    if (Math.random() < 0.35) push(Date.now());
    return {
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
    };
  };
}
