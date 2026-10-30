import type { BridgeSettings, BridgeStatus, SettingKey } from '../lib/status.js';

import { DEMO_KNOWLEDGE } from './demo-plugins.js';
import { EDIT_STORIES } from './examples.js';
import { LOG_MAX } from '../lib/log.js';
import { commandKind, speedOf, type CommandEntry } from '../lib/commands.js';
import type { BridgeHistory, LongHistory } from '../lib/timeline.js';
import type { Session } from '../lib/sessions.js';

// Fake bridge for `mcp_bridge.html?demo` — lets the UI be previewed without REAPER.

const COMMANDS: Array<[string, number, Record<string, unknown>]> = [
  ['list_tracks', 3, {}],
  ['get_track_properties', 2, { trackIndex: 3 }],
  ['set_fx_parameter', 0.6, { trackIndex: 3, fxIndex: 0, paramIndex: 4, value: 0.42 }],
  ['set_multiple_fx_parameters', 4, { params: '[{"trackIndex":3,"fxIndex":0,"paramIndex":1,"value":0.3}]' }],
  ['read_track_meters', 1.2, { trackIndex: 0 }],
  ['read_track_lufs', 18, { trackIndex: 0, targetLufs: -14 }],
  ['read_track_spectrum', 35, { trackIndex: 5, fftSize: 4096 }],
  ['read_track_correlation', 6, { trackIndex: 4 }],
  ['read_track_crest', 5, { trackIndex: 1 }],
  ['render_track_to_wav', 900, { trackIndex: 0, startTime: 30, endTime: 35, commandId: 'demo' }],
  ['add_fx', 22, { trackIndex: 3, fxName: 'VST3: Pro-Q 3' }],
  ['set_track_property', 0.8, { trackIndex: 2, property: 'volume', value: -3.5 }],
  ['snapshot_save', 60, { name: 'before-vocal-chain' }],
  ['get_fx_parameters', 9, { trackIndex: 3, fxIndex: 0 }],
  ['insert_envelope_points', 3, { trackIndex: 4, envelopeIndex: 0, points: '[…]' }],
  ['insert_midi_notes', 5, { trackIndex: 7, itemIndex: 0, notes: '[…]' }],
  ['analyze_midi', 4, { trackIndex: 2, itemIndex: 0 }],
  ['add_marker', 1.1, { position: 80, name: 'Drop' }],
  ['list_media_items', 1.4, { trackIndex: 4 }],
  ['run_plan', 14, { ops: '[…]', dryRun: true }],
];

const jitter = (v: number, by: number) => Math.round((v + (Math.random() - 0.5) * by) * 100) / 100;

/** What the bridge keeps of a measuring command's result (`r`), roughly like a mix bus reads */
function fakeResult(c: string): Record<string, unknown> | undefined {
  switch (c) {
    case 'read_track_meters':
      return { peakL: jitter(-4, 6), peakR: jitter(-5, 6), rmsL: jitter(-16, 4), rmsR: jitter(-17, 4) };
    case 'read_track_lufs':
      return { integrated: jitter(-12, 3), shortTerm: jitter(-11, 4), momentary: jitter(-10, 6), truePeakL: jitter(-1.2, 1.5), truePeakR: jitter(-1.6, 1.5), duration: 3 };
    case 'read_track_correlation':
      return { correlation: jitter(0.55, 0.9), stereoWidth: jitter(1.1, 0.4), midLevel: jitter(-15, 3), sideLevel: jitter(-24, 4) };
    case 'read_track_crest':
      return { crestFactor: jitter(11, 4), peakLevel: jitter(-3, 3), rmsLevel: jitter(-14, 3) };
    case 'read_track_spectrum': {
      // Pink-ish tilt with a low-end bump and a presence peak
      const bands = Array.from({ length: 48 }, (_, b) => {
        const hz = 20 * 1000 ** ((b + 0.5) / 48);
        const tilt = -3 * Math.log2(hz / 100);
        const low = 8 * Math.exp(-((Math.log2(hz / 60)) ** 2));
        const presence = 4 * Math.exp(-((Math.log2(hz / 3000)) ** 2) * 2);
        const air = hz > 16000 ? -12 * Math.log2(hz / 16000) * 3 : 0;
        return jitter(-24 + tilt + low + presence + air, 3);
      });
      return { peakDb: jitter(-6, 2), rmsDb: jitter(-18, 2), fftSize: 4096, sampleRate: 48000, bands };
    }
    case 'render_track_to_wav': {
      // A beat at 120 BPM: a hit every half second decaying under a sustained bed, sometimes hitting full scale
      const loud = 0.8 + Math.random() * 0.25;
      const hi = Array.from({ length: 120 }, (_, i) => {
        const sinceHit = (i % 12) / 12;
        return Math.round(Math.min(1, 0.03 + loud * Math.exp(-sinceHit * 9) + Math.random() * 0.02) * 100) / 100;
      });
      const lo = hi.map((v) => -Math.round((v * (0.9 + Math.random() * 0.1)) * 100) / 100);
      const top = Math.max(...hi);
      return {
        durationSeconds: 5, sampleRate: 44100, channels: 2, hi, lo,
        peakDb: Math.round(20 * Math.log10(top) * 100) / 100, rmsDb: jitter(-15, 2), clipped: top >= 1 ? Math.round(Math.random() * 40) + 1 : 0,
      };
    }
  }
  // Edit views: the gallery's example for the same command
  return EDIT_STORIES.find((st) => st.entry.c === c)?.entry.r;
}

const ERRORS = [
  'FX "VST3: Pro-Q 4" not found on track 3. Installed match candidates: Pro-Q 3',
  'Track index 42 out of range (project has 18 tracks)',
  'Handler error: mcp_bridge.lua:2214: attempt to index a nil value (local \'item\')',
];

const BUCKET_MS = 10_000;
/** The bridge's day and week tiers (1m and 10m buckets) */
const LONG_SIZES = [60_000, 600_000];
const DAY = 24 * 3_600_000;

type Bucket = [number, number, number, number, number];

export interface Demo {
  /** `log` (the bridge's saved log) comes with the first tick only, as the page reads it on open */
  tick(): { status: BridgeStatus; history: BridgeHistory; longHistory: LongHistory; log?: CommandEntry[] };
  set(key: SettingKey, on: boolean): void;
}

export function createDemo(): Demo {
  const startedAt = Date.now() - 47 * 60_000;
  let n = 0;
  let errors = 0;
  let recent: CommandEntry[] = [];
  let saved: CommandEntry[] = [];
  let first = true;
  const buckets = new Map<number, Bucket>();
  const long = LONG_SIZES.map(() => new Map<number, Bucket>());
  const count = (map: Map<number, Bucket>, size: number, t: number, total: number, errs: number, slow: number, ms: number) => {
    const id = Math.floor(t / size);
    const b = map.get(id) ?? [id, 0, 0, 0, 0];
    b[1] += total;
    b[2] += errs;
    b[3] += slow;
    b[4] += ms;
    map.set(id, b);
  };
  const settings: BridgeSettings = { paused: false, readonly: false, openOnStart: true, dev: false };
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
    const result = ok ? fakeResult(c) : undefined;
    if (result) entry.r = result;
    if (e) entry.e = e;
    recent = [entry, ...recent].slice(0, 50);
    saved = [entry, ...saved].slice(0, LOG_MAX);
    session.last = t;
    session.commands += 1;
    if (!ok) session.errors += 1;
    const slow = ok && !['fast', 'long'].includes(speedOf(c, entry.ms)) ? 1 : 0;
    count(buckets, BUCKET_MS, t, 1, ok ? 0 : 1, slow, entry.ms);
    long.forEach((map, i) => count(map, LONG_SIZES[i], t, 1, ok ? 0 : 1, slow, entry.ms));
  };

  // Earlier sessions this week, before this bridge run: only the day/week tiers know about them
  for (let t = startedAt - 7 * DAY; t < startedAt; t += 60_000) {
    const hour = new Date(t).getHours();
    if (hour < 10 || hour > 22 || Math.sin(t / 7_200_000) < 0.2) continue;
    const total = Math.round(Math.random() * 12);
    if (total === 0) continue;
    const errs = Math.random() < 0.15 ? 1 : 0;
    long.forEach((map, i) => count(map, LONG_SIZES[i], t, total, errs, Math.random() < 0.2 ? 1 : 0, total * 6));
  }

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
      const log = first ? saved : undefined;
      first = false;
      // Idle agents still ping every 20s
      sessions[1].last = Math.max(sessions[1].last, Date.now() - 8000);
      return {
        status: {
          v: 1,
          ts: Date.now(),
          startedAt,
          reaperVersion: '7.27/macOS-arm64',
          project: '/Users/you/Music/Projects/Midnight Drive/Midnight Drive — mix v3.rpp',
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
        longHistory: { v: 1, tiers: long.map((map, i) => ({ size: LONG_SIZES[i], b: [...map.values()].sort((a, b) => a[0] - b[0]) })) },
        ...(log ? { log } : {}),
      };
    },
    set(key, on) {
      if (key === 'cfg_paused') settings.paused = on;
      else if (key === 'cfg_readonly') settings.readonly = on;
      else if (key === 'cfg_dev') settings.dev = on;
      else settings.openOnStart = on;
    },
  };
}
