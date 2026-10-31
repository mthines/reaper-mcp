/**
 * The status feed and page settings of mcp_bridge.lua, run in real Lua (wasmoon) against the fake
 * ReaScript API with an in-memory ExtState — the channel the web status page reads and writes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory, type LuaEngine } from 'wasmoon';

const REAPER_DIR = join(__dirname, '../../../reaper');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_reaper.lua'), 'utf8');
const SCRIPTS = '/reaper/Scripts/';
const BRIDGE_DIR = `${SCRIPTS}mcp_bridge_data/`;
const LIBS = ['mcp_plan_lib.lua', 'mcp_actions_lib.lua', 'mcp_tracks_lib.lua', 'mcp_project_lib.lua', 'mcp_items_lib.lua', 'mcp_envelopes_lib.lua', 'mcp_edit_views_lib.lua', 'mcp_arrange_lib.lua'];

interface Entry { n: number; t: number; c: string; ok: boolean; s?: string; p?: string; e?: string; r?: Record<string, unknown> }
type Row = [number, number, number, number, number];
interface History { v: number; size: number; b: Row[] }
interface LongHistory { v: number; tiers: Array<{ size: number; b: Row[] }> }
interface Session { id: string; dir?: string; client?: string; commands: number; errors: number; ended?: boolean }
interface Status {
  commands: number;
  errors: number;
  recent: Entry[];
  sessions: Session[];
  settings: { paused: boolean; readonly: boolean; openOnStart: boolean; dev: boolean };
  health: { sws: boolean; jsfx: boolean; outdated: boolean };
  web?: { stuck: number; limit: number };
  control: { token: string; canRestart: boolean; canUpdate: boolean; changed?: boolean; update?: { kind: string; state: string } };
}

let engine: LuaEngine | undefined;
afterEach(() => {
  engine?.global.close();
  engine = undefined;
});

/** Extra files: a bare name lands in the bridge folder (left by an earlier run, the restart tests), an absolute path as is. */
async function startBridge(setup = '', files: Record<string, string> = {}) {
  const factory = new LuaFactory();
  await factory.mountFile(`${SCRIPTS}mcp_bridge.lua`, readFileSync(join(REAPER_DIR, 'mcp_bridge.lua'), 'utf8'));
  for (const lib of LIBS) await factory.mountFile(SCRIPTS + lib, readFileSync(join(REAPER_DIR, lib), 'utf8'));
  await factory.mountFile(`${BRIDGE_DIR}.keep`, '');
  for (const [name, content] of Object.entries(files)) await factory.mountFile(name.startsWith('/') ? name : BRIDGE_DIR + name, content);
  const lua = await factory.createEngine();
  engine = lua;
  await lua.doString(FAKE_SRC);
  await lua.doString(`
    local api = new_fake({ tracks = { { name = "Kick" } } })
    ext = {}
    api.GetResourcePath = function() return "/reaper" end
    api.GetPlayState = function() return 0 end
    api.GetProjectPath = function() return "/reaper/projects" end
    api.get_ini_file = function() return "/reaper/reaper.ini" end
    api.time_precise = os.clock
    api.defer = function(fn) next_tick = fn end
    api.CF_GetSWSVersion = false -- no SWS installed
    api.GetExtState = function(s, k) return ext[s .. "/" .. k] or "" end
    api.SetExtState = function(s, k, v) ext[s .. "/" .. k] = v end
    api.DeleteExtState = function(s, k) ext[s .. "/" .. k] = nil end
    api.atexit = function(fn) on_exit = fn end
    ${setup}
    reaper = setmetatable(api, { __index = function() return function() end end })
    dofile("${SCRIPTS}mcp_bridge.lua")
  `);

  let seq = 0;
  const tick = () => lua.doString('next_tick()');
  return {
    async send(type: string, params: Record<string, unknown> = {}, session?: Record<string, string>) {
      const id = `t${++seq}`;
      lua.global.set('CMD', JSON.stringify({ id, type, params, ...session }));
      const body: string = await lua.doString(`
        local f = assert(io.open("${BRIDGE_DIR}command_${id}.json", "w")); f:write(CMD); f:close()
        f = assert(io.open("${BRIDGE_DIR}_notify", "w")); f:write("${id}\\n"); f:close()
        next_tick()
        f = assert(io.open("${BRIDGE_DIR}response_${id}.json", "r"))
        local body = f:read("a"); f:close()
        return body
      `);
      return JSON.parse(body) as { success: boolean; error?: string };
    },
    async set(key: string, value: string) {
      lua.global.set('V', value);
      await lua.doString(`ext["MCPBridge/${key}"] = V`);
    },
    async status(): Promise<Status> {
      // Publishing is throttled to 5/s; wait it out so the next tick publishes
      await new Promise((r) => setTimeout(r, 250));
      await tick();
      return JSON.parse(await lua.doString('return ext["MCPBridge/status"]')) as Status;
    },
    /** A Lua global (or any expression) from the bridge's state */
    async eval(expr: string): Promise<unknown> {
      return lua.doString(`return ${expr}`);
    },
    async ext(key: string): Promise<string | null> {
      return (await lua.doString(`return ext["MCPBridge/${key}"]`)) ?? null;
    },
    /** REAPER quits (or the script stops): runs the bridge's atexit handler. */
    async exit() {
      await lua.doString('on_exit()');
    },
    async file(name: string): Promise<string | null> {
      return (await lua.doString(`
        local f = io.open("${BRIDGE_DIR}${name}", "r")
        if not f then return nil end
        local body = f:read("a"); f:close()
        return body
      `)) ?? null;
    },
  };
}

const A = { sessionId: 'sess-a', sessionDir: '/work/song-a', sessionClient: 'claude-code' };
const B = { sessionId: 'sess-b', sessionDir: '/work/song-b' };

describe('bridge status feed', () => {
  it('groups commands by the session that sent them', async () => {
    const bridge = await startBridge();
    await bridge.send('get_project_info', {}, A);
    await bridge.send('list_tracks', {}, A);
    await bridge.send('no_such_command', {}, B);

    const { sessions, recent } = await bridge.status();
    expect(sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sess-a', dir: '/work/song-a', client: 'claude-code', commands: 2, errors: 0 }),
      expect.objectContaining({ id: 'sess-b', commands: 1, errors: 1 }),
    ]));
    expect(recent.map((e) => e.s)).toEqual(['sess-b', 'sess-a', 'sess-a']);
  });

  it('keeps an idle session alive from its ping and marks it ended on goodbye', async () => {
    const bridge = await startBridge();
    await bridge.send('_session', {}, A);
    const first = await bridge.status();
    expect(first.commands).toBe(0); // pings aren't logged as commands
    expect(first.sessions).toEqual([expect.objectContaining({ id: 'sess-a', commands: 0 })]);

    await bridge.send('_session', { ended: 1 }, A);
    const { sessions } = await bridge.status();
    expect(sessions[0].ended).toBe(true);
  });

  it('counts a system error as an error, a refused request only as a command', async () => {
    const bridge = await startBridge();
    const refused = await bridge.send('get_track_properties', { trackIndex: 99999 }, A);
    expect(refused.success).toBe(false);
    await bridge.send('no_such_command', {}, A);

    const status = await bridge.status();
    expect(status.commands).toBe(2);
    expect(status.errors).toBe(1);
    expect(status.sessions[0]).toMatchObject({ commands: 2, errors: 1 });
    // The timeline publishes at most once a second
    await new Promise((r) => setTimeout(r, 1000));
    await bridge.status();
    const buckets = JSON.parse((await bridge.ext('history')) ?? '{}').b as number[][];
    expect(buckets.reduce((sum, b) => sum + b[2], 0)).toBe(1);
  });

  it('captures request params for the details drawer', async () => {
    const bridge = await startBridge();
    await bridge.send('get_track_properties', { trackIndex: 0 }, A);
    const { recent } = await bridge.status();
    expect(JSON.parse(recent[0].p as string)).toEqual({ trackIndex: 0 });
  });

  it('logs an array param as JSON, not as the raw text the command parser left it in', async () => {
    const bridge = await startBridge();
    const updates = [{ trackIndex: 0, fxIndex: 0, paramIndex: 2, value: 0.5 }];
    await bridge.send('set_multiple_fx_parameters', { updates }, A);
    const { recent } = await bridge.status();
    expect(JSON.parse(recent[0].p as string)).toEqual({ updates });
  });
});

describe('measurement results in the log', () => {
  it('keeps meter readings, rounded, and nothing for other commands', async () => {
    const bridge = await startBridge('api.Track_GetPeakInfo = function(_, ch) return ch == 0 and 0.5 or 0.25 end');
    await bridge.send('read_track_meters', { trackIndex: 0 });
    await bridge.send('get_project_info', {});
    const { recent } = await bridge.status();
    expect(recent[1].r).toEqual({ peakL: -6.02, peakR: -12.04, rmsL: -9.03, rmsR: -15.05 });
    expect(recent[0].r).toBeUndefined();
  });

  it('folds the spectrum into 48 log-spaced bands, loudest bin each', async () => {
    // 2048 bins at 48 kHz / 4096: ~11.7 Hz per bin; -20 dB around 1 kHz, -80 dB elsewhere
    const bridge = await startBridge(`
      api.GetSetProjectInfo = function() return 48000 end
      api.TrackFX_GetParam = function() return 4096 end
      api.gmem_read = function(i)
        i = i - 4100 -- track 0's analyzer block (slot 1)
        if i == 0 then return 2048 elseif i == 1 then return -3 elseif i == 2 then return -12 end
        local hz = (i - 3) * 48000 / 4096
        return (hz > 900 and hz < 1100) and -20 or -80
      end
    `);
    const res = await bridge.send('read_track_spectrum', { trackIndex: 0, fftSize: 4096 });
    expect(res.error).toBeUndefined();
    const r = (await bridge.status()).recent[0].r as { bands: number[]; peakDb: number; sampleRate: number };
    expect(r).toMatchObject({ peakDb: -3, sampleRate: 48000, fftSize: 4096 });
    expect(r.bands).toHaveLength(48);
    const loud = r.bands.flatMap((v, b) => (v === -20 ? [20 * 1000 ** ((b + 0.5) / 48)] : []));
    expect(loud.length).toBeGreaterThan(0);
    for (const hz of loud) {
      expect(hz).toBeGreaterThan(800);
      expect(hz).toBeLessThan(1250);
    }
  });
  it("draws a render's waveform from the WAV it wrote, clipping counted", async () => {
    // The render writes 1 s of 16-bit stereo at 1 kHz: a quiet first half, then a full-scale square
    const bridge = await startBridge(`
      local render = {}
      api.GetTempPath = function() return "/tmp/" end
      api.GetSetProjectInfo_String = function(_, k, v, set) if set then render[k] = v end return true, render[k] or "" end
      api.Main_OnCommand = function(id)
        if id ~= 42230 then return end
        local frames = {}
        for i = 0, 999 do
          local v = i < 500 and 3277 or (i % 2 == 0 and 32767 or -32767)
          frames[#frames + 1] = string.pack("<i2i2", v, -v)
        end
        local data = table.concat(frames)
        local fmt = string.pack("<I2I2I4I4I2I2", 1, 2, 1000, 4000, 4, 16)
        local f = io.open(render.RENDER_FILE .. render.RENDER_PATTERN .. ".wav", "wb")
        f:write("RIFF", string.pack("<I4", 4 + 8 + #fmt + 8 + #data), "WAVE", "fmt ", string.pack("<I4", #fmt), fmt,
          "data", string.pack("<I4", #data), data)
        f:close()
      end
    `);
    const res = (await bridge.send('render_track_to_wav', { trackIndex: 0, startTime: 2, endTime: 3, commandId: 'abc' })) as {
      success: boolean;
      data?: Record<string, unknown>;
    };
    expect(res.success).toBe(true);
    expect(res.data).not.toHaveProperty('hi'); // the agent's answer stays as it was

    const r = (await bridge.status()).recent[0].r as { hi: number[]; lo: number[]; peakDb: number; clipped: number; durationSeconds: number };
    expect(r.durationSeconds).toBe(1);
    expect(r.hi).toHaveLength(120);
    expect(r.hi[10]).toBeCloseTo(0.1, 2);
    expect(r.lo[10]).toBeCloseTo(-0.1, 2);
    expect(r.hi[100]).toBe(1);
    expect(r.lo[100]).toBe(-1);
    expect(r.peakDb).toBe(0);
    expect(r.clipped).toBe(1000); // 500 frames × 2 channels at full scale
  });
});

const MIDI_ITEM = `
  -- One 4-bar MIDI item at 0 s, 120 BPM (2 beats per second), 960 PPQ
  local item, take = {}, {}
  notes = { { 0, 960, 36, 100 }, { 1920, 2880, 38, 90 } }
  api.CountTrackMediaItems = function() return 1 end
  api.GetTrackMediaItem = function() return item end
  api.GetActiveTake = function() return take end
  api.TakeIsMIDI = function() return true end
  api.GetMediaItemInfo_Value = function(_, k) return k == "D_LENGTH" and 8 or 0 end
  api.TimeMap2_timeToQN = function(_, t) return t * 2 end
  api.TimeMap2_QNToTime = function(_, q) return q / 2 end
  api.TimeMap_GetTimeSigAtTime = function() return 4, 4, 120 end
  api.MIDI_GetProjTimeFromPPQPos = function(_, ppq) return ppq / 1920 end
  api.MIDI_GetPPQPosFromProjTime = function(_, t) return t * 1920 end
  api.MIDI_CountEvts = function() return true, #notes, 0, 0 end
  api.MIDI_GetNote = function(_, i) local n = notes[i + 1] return true, false, false, n[1], n[2], 0, n[3], n[4] end
  api.MIDI_InsertNote = function(_, _, _, s, e, _, p, v) notes[#notes + 1] = { s, e, p, v } end
  api.MIDI_SetNote = function(_, i, _, _, s, e, _, p, v) local n = notes[i + 1] n[1], n[2], n[3], n[4] = s or n[1], e or n[2], p or n[3], v or n[4] end
  api.MIDI_DeleteNote = function(_, i) table.remove(notes, i + 1) end
  api.MIDI_Sort = function() table.sort(notes, function(a, b) return a[1] < b[1] end) end
`;

const VOLUME_ENVELOPE = `
  -- A volume envelope with 0 dB at 1 s and -6 dB at 3 s
  local env = {}
  pts = { { 1, 1, 0 }, { 3, 0.5, 0 } }
  api.CountTrackEnvelopes = function() return 1 end
  api.GetTrackEnvelope = function() return env end
  api.GetEnvelopeName = function() return true, "Volume" end
  api.GetEnvelopeScalingMode = function() return 0 end
  api.ScaleFromEnvelopeMode = function(_, v) return v end
  api.CountEnvelopePoints = function() return #pts end
  api.GetEnvelopePoint = function(_, i) local p = pts[i + 1] return true, p[1], p[2], p[3], 0, false end
  api.InsertEnvelopePoint = function(_, t, v, s) pts[#pts + 1] = { t, v, s } end
  api.Envelope_SortPoints = function() table.sort(pts, function(a, b) return a[1] < b[1] end) end
  -- The envelope lib's calls (-1 = the envelope itself)
  api.CountEnvelopePointsEx = function(e) return api.CountEnvelopePoints(e) end
  api.GetEnvelopePointEx = function(e, _, i) return api.GetEnvelopePoint(e, i) end
  api.InsertEnvelopePointEx = function(e, _, t, v, s) return api.InsertEnvelopePoint(e, t, v, s) end
  api.Envelope_SortPointsEx = function(e) return api.Envelope_SortPoints(e) end
`;

// The volume envelope above with one chorus automation item (pool 7, -1 dB) that pooled copies share
const POOLED_ENVELOPE = `${VOLUME_ENVELOPE}
  ais = { { pool = 7, pos = 10, len = 4 } }
  pool_pts = { [7] = { { 0, 0.891, 0 }, { 4, 0.891, 0 } } }
  local KEY = { D_POOL_ID = "pool", D_POSITION = "pos", D_LENGTH = "len" }
  api.CountAutomationItems = function() return #ais end
  api.GetSetAutomationItemInfo = function(_, i, parm, v, set)
    local a = ais[i + 1]
    if set then a[KEY[parm] or parm] = v end
    return a[KEY[parm] or parm] or 0
  end
  api.GetSetAutomationItemInfo_String = function(_, i, parm) return true, ais[i + 1].pool == 7 and "Vox Chorus" or "" end
  api.InsertAutomationItem = function(_, pool, pos, len)
    ais[#ais + 1] = { pool = pool, pos = pos, len = len }
    return #ais - 1
  end
  local function item_pts(ai) return pool_pts[ais[(ai & ~0x10000000) + 1].pool] or {} end
  local plain_count, plain_get = api.CountEnvelopePointsEx, api.GetEnvelopePointEx
  api.CountEnvelopePointsEx = function(e, ai) if ai < 0 then return plain_count(e, ai) end return #item_pts(ai) end
  api.GetEnvelopePointEx = function(e, ai, i)
    if ai < 0 then return plain_get(e, ai, i) end
    local p = item_pts(ai)[i + 1]
    return true, ais[(ai & ~0x10000000) + 1].pos + p[1], p[2], p[3], 0, false
  end
`;

describe('edit views in the log', () => {
  it('draws pooled automation items with their shared curve, the new one marked', async () => {
    const bridge = await startBridge(POOLED_ENVELOPE);
    await bridge.send('insert_automation_item', { trackIndex: 0, envelopeIndex: 0, position: 30, length: 4, poolId: 7 });
    const { r } = (await bridge.status()).recent[0];
    expect(r).toMatchObject({
      env: 'Volume', unit: 'dB',
      ais: [[10, 4, 7, 'Vox Chorus'], [30, 4, 7, 'Vox Chorus']],
      pools: [[7, [[0, -1, 0], [4, -1, 0]]]],
      ai: 1,
      wasAis: [[10, 4, 7, 'Vox Chorus']],
    });
  });

  it('render view in the log: one row per file with its levels, waveform slices and the targets', async () => {
    const setup = `
      api.project.strings.RENDER_FILE = "/out"
      api.project.strings.RENDER_PATTERN = "mix"
      api.project.info.RENDER_NORMALIZE = 1 | 64
      api.project.info.RENDER_NORMALIZE_TARGET = 10 ^ (-14 / 20)
      api.project.info.RENDER_BRICKWALL = 10 ^ (-1 / 20)
      local render = api.Main_OnCommand
      api.Main_OnCommand = function(id, flag)
        render(id, flag)
        if id == 42230 then for path in pairs(api.rendered) do local f = io.open(path, "w"); f:write("RIFF"); f:close() end end
      end
      api.new_array = function() return {} end
      api.GetMediaSourceNumChannels = function() return 2 end
      api.PCM_Source_BuildPeaks = function() return 0 end
      api.PCM_Source_GetPeaks = function(src, rate, start, ch, n, extra, buf)
        for i = 0, n - 1 do
          for c = 1, ch do buf[i * ch + c] = 0.5; buf[n * ch + i * ch + c] = -0.25 end
        end
        return n
      end
    `;
    const bridge = await startBridge(setup, { '/out/.keep': '' });
    const res = await bridge.send('render_project', {});
    expect(res.error ?? 'ok').toBe('ok');
    const { r } = (await bridge.status()).recent[0];
    expect(r).toMatchObject({ fmt: 'wav', src: 'master', norm: 'lufs_i', nt: -14, lim: -1, tp: false });
    const row = (r as { groups: Array<{ v: string; f: unknown[][] }> }).groups[0].f[0];
    expect(row.slice(0, 5)).toEqual(['mix.wav', 12.5, -14, -1, -1.5]);
    expect((row[5] as number[]).length).toBe(60);
    expect((row[5] as number[])[0]).toBe(0.5);
    expect((row[6] as number[])[0]).toBe(-0.25);
  });

  it('render view in the log: peaks built only for the waveform are not left beside the rendered file', async () => {
    const setup = `
      api.project.strings.RENDER_FILE = "/out"
      api.project.strings.RENDER_PATTERN = "mix"
      local render = api.Main_OnCommand
      api.Main_OnCommand = function(id, flag)
        render(id, flag)
        if id == 42230 then for path in pairs(api.rendered) do local f = io.open(path, "w"); f:write("RIFF"); f:close() end end
      end
      api.new_array = function() return {} end
      api.GetMediaSourceNumChannels = function() return 2 end
      local create = api.PCM_Source_CreateFromFile
      api.PCM_Source_CreateFromFile = function(path) peaks_for = path; return create and create(path) or { path = path } end
      api.GetPeakFileName = function(path) return path .. ".reapeaks" end
      api.PCM_Source_BuildPeaks = function(_, mode)
        if mode == 2 then local f = io.open(peaks_for .. ".reapeaks", "w"); f:write("RPKN"); f:close() end
        return mode == 0 and 1 or 0
      end
      api.PCM_Source_GetPeaks = function(src, rate, start, ch, n, extra, buf)
        for i = 0, n * ch * 2 do buf[i] = 0.5 end
        return n
      end
    `;
    const bridge = await startBridge(setup, { '/out/.keep': '' });
    expect((await bridge.send('render_project', {})).error ?? 'ok').toBe('ok');
    const row = ((await bridge.status()).recent[0].r as { groups: Array<{ f: unknown[][] }> }).groups[0].f[0];
    expect((row[5] as number[]).length).toBe(60);
    expect(await bridge.eval('(function() local f = io.open("/out/mix.wav.reapeaks", "rb"); if f then f:close() end; return f ~= nil end)()')).toBe(false);
  });

  it('render view in the log: once waveforms took a second, the remaining files are listed without one', async () => {
    const setup = `
      api.project.strings.RENDER_FILE = "/out"
      api.project.strings.RENDER_PATTERN = "song"
      local render = api.Main_OnCommand
      api.Main_OnCommand = function(id, flag)
        render(id, flag)
        if id == 42230 then for path in pairs(api.rendered) do local f = io.open(path, "w"); f:write("RIFF"); f:close() end end
      end
      fake_now = 0
      api.time_precise = function() return fake_now end
      api.new_array = function() return {} end
      api.GetMediaSourceNumChannels = function() return 2 end
      -- Each waveform takes 0.6 s of the main thread
      api.PCM_Source_BuildPeaks = function(_, mode) if mode == 2 then fake_now = fake_now + 0.6 end return mode == 0 and 1 or 0 end
      api.PCM_Source_GetPeaks = function(src, rate, start, ch, n, extra, buf)
        for i = 0, n * ch * 2 do buf[i] = 0.5 end
        return n
      end
      api.tracks[2] = { name = "Vocals", guid = "{v}", vals = {}, fx = {}, sends = {}, chunk = "" }
    `;
    const bridge = await startBridge(setup, { '/out/.keep': '' });
    const res = await bridge.send('render_versions', { versions: JSON.stringify([{ name: 'A' }, { name: 'B', mute: ['Vocals'] }, { name: 'C', mute: ['Vocals'] }]) });
    expect(res.error ?? 'ok').toBe('ok');
    const groups = ((await bridge.status()).recent[0].r as { groups: Array<{ f: unknown[][] }> }).groups;
    expect(groups.map((g) => (g.f[0][5] as number[]).length)).toEqual([60, 60, 0]);
  });

  it('render view in the log: versions are grouped, each with its muted tracks', async () => {
    const setup = `
      api.tracks[2] = { name = "Vocals", guid = "{v}", vals = {}, fx = {}, sends = {}, chunk = "" }
      api.project.strings.RENDER_FILE = "/out"
      api.project.strings.RENDER_PATTERN = "song"
      local render = api.Main_OnCommand
      api.Main_OnCommand = function(id, flag)
        render(id, flag)
        if id == 42230 then for path in pairs(api.rendered) do local f = io.open(path, "w"); f:write("RIFF"); f:close() end end
      end
    `;
    const bridge = await startBridge(setup, { '/out/.keep': '' });
    const res = await bridge.send('render_versions', { versions: JSON.stringify([{ name: 'Full' }, { name: 'Instrumental', mute: ['Vocals'] }]) });
    expect(res.error ?? 'ok').toBe('ok');
    const { r } = (await bridge.status()).recent[0];
    const groups = (r as { groups: Array<{ v: string; m: string[]; f: unknown[][] }> }).groups;
    expect(groups.map((g) => [g.v, g.m, g.f[0][0]])).toEqual([
      ['Full', [], 'song-Full.wav'],
      ['Instrumental', ['Vocals'], 'song-Instrumental.wav'],
    ]);
  });

  it('shows a track change as before and after, in dB', async () => {
    const bridge = await startBridge('api.tracks[1].vals.D_VOL = 1');
    await bridge.send('set_track_property', { trackIndex: 0, property: 'volume', value: -6 });
    const { r } = (await bridge.status()).recent[0];
    expect(r).toEqual({ rows: [{ t: 'Kick', p: 'volume', s: 'db', a: 0, b: -6 }] });
  });

  it('shows an FX parameter change with the plugin’s own readout', async () => {
    const bridge = await startBridge(`
      api.tracks[1].fx[1] = { name = "ReaEQ", guid = "{eq}", params = { [0] = 0.5 } }
      api.TrackFX_GetParamName = function() return true, "Gain" end
      api.TrackFX_GetParamNormalized = function(tr, fx, p) return tr.fx[fx + 1].params[p] end
      api.TrackFX_GetFormattedParamValue = function(tr, fx, p) return true, string.format("%+.1f dB", (tr.fx[fx + 1].params[p] - 0.5) * 24) end
    `);
    await bridge.send('set_fx_parameter', { trackIndex: 0, fxIndex: 0, paramIndex: 0, value: 0.75 });
    const { r } = (await bridge.status()).recent[0];
    expect(r).toEqual({ rows: [{ t: 'Kick · ReaEQ', p: 'Gain', s: 'norm', a: 0.5, b: 0.75, at: '+0.0 dB', bt: '+6.0 dB' }] });
  });

  it('shows the automation around an inserted point, with the curve it replaced', async () => {
    const bridge = await startBridge(VOLUME_ENVELOPE);
    await bridge.send('insert_envelope_point', { trackIndex: 0, envelopeIndex: 0, time: 2, value: 0.25 });
    const { r } = (await bridge.status()).recent[0];
    expect(r).toEqual({
      env: 'Volume', unit: 'dB', from: 1, to: 3, count: 3,
      pts: [[1, 0, 0], [2, -12.04, 0], [3, -6.02, 0]],
      was: [[1, 0, 0], [3, -6.02, 0]],
    });
  });

  it('marks the notes a MIDI edit added and lists the ones it removed', async () => {
    const bridge = await startBridge(MIDI_ITEM);
    await bridge.send('insert_midi_note', { trackIndex: 0, itemIndex: 0, pitch: 42, velocity: 80, startPosition: 1, duration: 0.5 });
    let r = (await bridge.status()).recent[0].r;
    expect(r).toEqual({
      total: 3, beats: 16, ts: [4, 4], more: 0, gone: [],
      notes: [[36, 0, 1, 100, 0], [42, 1, 0.5, 80, 1], [38, 2, 1, 90, 0]],
    });

    await bridge.send('delete_midi_note', { trackIndex: 0, itemIndex: 0, noteIndex: 0 });
    r = (await bridge.status()).recent[0].r;
    expect(r).toMatchObject({ total: 2, gone: [[36, 0, 1, 100]] });
  });

  it('summarises a MIDI analysis per pitch', async () => {
    const bridge = await startBridge(MIDI_ITEM);
    await bridge.send('analyze_midi', { trackIndex: 0, itemIndex: 0 });
    const r = (await bridge.status()).recent[0].r as { total: number; pitches: number[][] };
    expect(r.total).toBe(2);
    expect(r.pitches.map((p) => p.slice(0, 4))).toEqual([[36, 1, 100, 100], [38, 1, 90, 90]]);
  });

  it('keeps the first 256 notes of a large item and counts the rest', async () => {
    const bridge = await startBridge(`${MIDI_ITEM}
      notes = {}
      for i = 0, 299 do notes[#notes + 1] = { i * 240, i * 240 + 120, 60, 100 } end
    `);
    await bridge.send('get_midi_notes', { trackIndex: 0, itemIndex: 0 });
    const r = (await bridge.status()).recent[0].r as { notes: unknown[]; more: number; total: number };
    expect(r.notes).toHaveLength(256);
    expect(r).toMatchObject({ total: 300, more: 44 });
  });

  it('shows markers and regions on the timeline, with what was there before', async () => {
    const bridge = await startBridge(`
      api.AddProjectMarker2 = function(_, rgn, pos, rend, name, _, color)
        local num = #api.project.markers + 1
        table.insert(api.project.markers, { rgn = rgn, pos = pos, rend = rend, name = name, num = num, color = color or 0 })
        return num
      end
    `);
    await bridge.send('add_region', { start: 0, end: 16, name: 'Verse' });
    await bridge.send('add_marker', { position: 8, name: 'Drop' });
    const r = (await bridge.status()).recent[0].r as Record<string, unknown>;
    expect(r).toMatchObject({
      regions: [[0, 16, 'Verse', '', 1]],
      markers: [[8, 'Drop', '', 2]],
      tempo: [[0, 120, 4, 4, 0]],
      len: 16,
      was: { regions: [[0, 16, 'Verse', '', 1]], markers: [] },
    });
  });

  it('draws the mixer from a track listing: folders, levels and states', async () => {
    const bridge = await startBridge(`
      api.tracks[1].vals.I_FOLDERDEPTH = 1
      api.tracks[1].vals.D_VOL = 1
      api.tracks[2] = { name = "Snare", guid = "{s}", vals = { D_VOL = 0.5, B_MUTE = 1, I_FOLDERDEPTH = -1 }, fx = {}, sends = {}, chunk = "" }
    `);
    await bridge.send('list_tracks');
    const r = (await bridge.status()).recent[0].r as { tracks: unknown[]; total: number };
    expect(r.total).toBe(2);
    expect(r.tracks).toEqual([
      ['Kick', 0, '', 0, 0, 'F'],
      ['Snare', 1, '', -6.02, 0, 'M'],
    ]);
  });

  it('lists a plan’s ops in order', async () => {
    const bridge = await startBridge('api.CF_Json_Parse = false');
    const ops = [
      { op: 'add_track', name: 'Bass', as: '$bass' },
      { op: 'add_fx', track: '$bass', fxName: 'ReaComp' },
    ];
    expect((await bridge.send('run_plan', { ops: JSON.stringify(ops), dryRun: true })).error).toBeUndefined();
    const r = (await bridge.status()).recent[0].r;
    expect(r).toMatchObject({ ops: [['add_track', 'Bass'], ['add_fx', '$bass · ReaComp']], total: 2, dryRun: true });
  });

  it('shows an FX chain before and after a bypass, and after a removal', async () => {
    const bridge = await startBridge(`
      api.tracks[1].fx = { { name = "ReaEQ", guid = "{eq111111}", params = {} }, { name = "ReaComp", guid = "{comp2222}", params = {} } }
      api.TrackFX_GetEnabled = function(tr, i) return tr.fx[i + 1].enabled ~= false end
    `);
    await bridge.send('set_fx_enabled', { trackIndex: 0, fxIndex: 1, enabled: 0 });
    let r = (await bridge.status()).recent[0].r;
    expect(r).toEqual({
      chains: [{
        t: 'Kick',
        fx: [['ReaEQ', '', 'eq111111', ''], ['ReaComp', 'B', 'comp2222', '']],
        was: [['ReaEQ', '', 'eq111111', ''], ['ReaComp', '', 'comp2222', '']],
      }],
    });

    await bridge.send('remove_fx', { trackIndex: 0, fxIndex: 0 });
    r = (await bridge.status()).recent[0].r;
    expect(r).toMatchObject({ chains: [{ fx: [['ReaComp', 'B', 'comp2222', '']], was: [['ReaEQ', '', 'eq111111', ''], ['ReaComp', 'B', 'comp2222', '']] }] });
  });

  it('shows the FX chain a track listing reads, without a before', async () => {
    const bridge = await startBridge('api.tracks[1].fx = { { name = "ReaEQ", guid = "{eq111111}", params = {} } }');
    await bridge.send('get_track_properties', { trackIndex: 0 });
    expect((await bridge.status()).recent[0].r).toEqual({ chains: [{ t: 'Kick', fx: [['ReaEQ', '', 'eq111111', '']] }] });
  });

  it('draws a moved item on its track lane, with where it was', async () => {
    const bridge = await startBridge(`
      api.tracks[1].items = { { vals = { D_POSITION = 2, D_LENGTH = 4, D_FADEINLEN = 0.5 }, takes = {} } }
    `);
    await bridge.send('move_media_item', { trackIndex: 0, itemIndex: 0, newPosition: 10 });
    const r = (await bridge.status()).recent[0].r;
    expect(r).toMatchObject({
      lanes: [{ t: 'Kick', items: [[10, 4, 0.5, 0, 0, 0]], was: [[2, 4, 0.5, 0, 0, 0]] }],
      len: 14,
    });
  });

  it('lists a track’s sends before and after one is added', async () => {
    const bridge = await startBridge(`
      api.tracks[2] = { name = "Verb", guid = "{verb}", vals = {}, fx = {}, sends = {}, chunk = "" }
    `);
    await bridge.send('add_send', { from: 0, to: 'Verb', volume: -12 });
    const r = (await bridge.status()).recent[0].r;
    expect(r).toEqual({ t: 'Kick', routes: [['s', 'Verb', -12, 0, '']], was: [] });
  });

  it('marks the track a structure edit added, with the mixer before', async () => {
    const bridge = await startBridge();
    await bridge.send('add_track', { name: 'Bass' });
    const r = (await bridge.status()).recent[0].r as { tracks: unknown[][]; ids: string[]; was: { tracks: unknown[][]; ids: string[] } };
    expect(r.tracks.map((t) => t[0])).toEqual(['Kick', 'Bass']);
    expect(r.was.tracks.map((t) => t[0])).toEqual(['Kick']);
    expect(r.ids).toHaveLength(2);
    expect(r.ids).toContain(r.was.ids[0]);
  });

  it('shows the rows around a structure edit in a project too big to draw whole', async () => {
    const bridge = await startBridge(`
      for i = 2, 100 do api.tracks[i] = { name = "T" .. i, guid = "{t" .. i .. "}", vals = {}, fx = {}, sends = {}, chunk = "" } end
    `);
    await bridge.send('add_track', { name: 'Scratch' });
    const r = (await bridge.status()).recent[0].r as { tracks: unknown[][]; ids: string[]; total: number; from: number; was: { tracks: unknown[][] } };
    expect(r.total).toBe(101);
    expect(r.tracks.at(-1)?.[0]).toBe('Scratch'); // the new last track is drawn…
    expect(r.from).toBeGreaterThan(0); // …because the window starts near it, not at the first track
    expect(r.tracks.length).toBe(r.was.tracks.length + 1);
  });

  it('draws a MIDI CC as a lane of held values, with the lane before an insert', async () => {
    const bridge = await startBridge(`${MIDI_ITEM}
      ccs = { { 0, 7, 100 }, { 1920, 7, 80 }, { 960, 1, 20 } }
      api.MIDI_CountEvts = function() return true, #notes, #ccs, 0 end
      api.MIDI_GetCC = function(_, i) local c = ccs[i + 1] return true, false, false, c[1], 176, 0, c[2], c[3] end
      api.MIDI_InsertCC = function(_, _, _, ppq, _, _, n, v) ccs[#ccs + 1] = { ppq, n, v } end
    `);
    await bridge.send('insert_midi_cc', { trackIndex: 0, itemIndex: 0, ccNumber: 7, value: 64, position: 3 });
    const r = (await bridge.status()).recent[0].r as { env: string; unit: string; pts: number[][]; was: number[][]; otherCcs: number };
    expect(r).toMatchObject({ env: 'CC 7 · Volume', unit: 'cc', beats: 1, otherCcs: 1 });
    expect(r.pts.map((p) => p[1])).toEqual([100, 80, 64]);
    expect(r.was.map((p) => p[1])).toEqual([100, 80]);
  });

  it('logs a sidecar tool’s result as that tool’s entry, with its result', async () => {
    const bridge = await startBridge();
    const r = { name: 'Mix', lufs: -9.8, sections: [[0, 10, -10.2]] };
    await bridge.send('_log_result', { command: 'analyze_track_offline', ms: 2400, ok: 1, p: '{"trackIndex":-1}', r: JSON.stringify(r) });
    const { recent, commands } = await bridge.status();
    expect(recent[0]).toMatchObject({ c: 'analyze_track_offline', ms: 2400, ok: true, p: '{"trackIndex":-1}', r });
    expect(commands).toBe(1);
  });

  it('shows the time selection and edit cursor with where they were', async () => {
    const bridge = await startBridge();
    await bridge.send('set_time_selection', { start: 4, end: 12 });
    await bridge.send('set_time_selection', { start: 8, end: 16 });
    const r = (await bridge.status()).recent[0].r;
    expect(r).toMatchObject({ sel: [8, 16], wasSel: [4, 12], cur: 0, len: 16 });
  });
});

describe('arrangement view in the log', () => {
  const SONG = `
    api.tracks[1].items = { { vals = { D_POSITION = 2, D_LENGTH = 4 }, takes = {} }, { vals = { D_POSITION = 10, D_LENGTH = 2 }, takes = {} } }
    api.DeleteTrackMediaItem = function(tr, it)
      for i, x in ipairs(tr.items) do if x == it then table.remove(tr.items, i) return true end end
    end
  `;

  it('arrangement view in the log: insert time shows the opened span and the items before and after', async () => {
    const bridge = await startBridge(SONG);
    const res = await bridge.send('insert_time', { position: 8, length: 4 });
    expect(res.success).toBe(true);
    const r = (await bridge.status()).recent[0].r;
    expect(r).toMatchObject({
      op: 'insert', span: [8, 12],
      lanes: [{ t: 'Kick', items: [[2, 4, 0, 0, 0, 0], [14, 2, 0, 0, 0, 0]], was: [[2, 4, 0, 0, 0, 0], [10, 2, 0, 0, 0, 0]] }],
      len: 16,
    });
    expect(r).toHaveProperty('was');
  });

  it('arrangement view in the log: remove time shows the cut span, with the items it deleted as before', async () => {
    const bridge = await startBridge(SONG);
    expect((await bridge.send('remove_time', { start: 1, end: 7 })).success).toBe(true);
    const r = (await bridge.status()).recent[0].r;
    expect(r).toMatchObject({
      op: 'remove', span: [1, 7],
      lanes: [{ t: 'Kick', items: [[4, 2, 0, 0, 0, 0]], was: [[2, 4, 0, 0, 0, 0], [10, 2, 0, 0, 0, 0]] }],
    });
  });

  it('arrangement view in the log: processing items on six tracks draws four lanes and counts the other two', async () => {
    const bridge = await startBridge(`
      for t = 1, 6 do
        api.tracks[t] = api.tracks[t] or { name = "T" .. t, guid = "{T" .. t .. "}", vals = {}, fx = {}, sends = {}, chunk = "" }
        api.tracks[t].items = { { vals = { D_POSITION = t, D_LENGTH = 1 }, takes = {} } }
      end
      api.Main_OnCommand = function() end
      local function all() local l = {} for _, tr in ipairs(api.tracks) do for _, it in ipairs(tr.items or {}) do l[#l + 1] = it end end return l end
      api.CountMediaItems = function() return #all() end
      api.GetMediaItem = function(_, i) return all()[i + 1] end
      api.IsMediaItemSelected = function(it) return it.selected == true end
      api.SetMediaItemSelected = function(it, on) it.selected = on end
      api.SelectAllMediaItems = function(_, on) for _, it in ipairs(all()) do it.selected = on end end
      api.ValidatePtr2 = api.ValidatePtr2 or function() return true end
      api.GetMediaItem_Track = function(it)
        for _, tr in ipairs(api.tracks) do for _, x in ipairs(tr.items or {}) do if x == it then return tr end end end
      end
    `);
    const items = [0, 1, 2, 3, 4, 5].map((t) => ({ trackIndex: t, itemIndex: 0 }));
    const res = await bridge.send('process_items', { operation: 'glue', items: JSON.stringify(items) });
    expect(res.success, res.error).toBe(true);
    const r = (await bridge.status()).recent[0].r;
    expect(r).toMatchObject({ moreTracks: 2 });
    expect(r?.lanes).toHaveLength(4);
  });

  it('arrangement view in the log: a refused edit keeps no view', async () => {
    const bridge = await startBridge(SONG);
    const res = await bridge.send('remove_time', { start: 5, end: 1 });
    expect(res.success).toBe(false);
    expect(res.error).toContain('nothing changed');
    expect((await bridge.status()).recent[0].r).toBeUndefined();
  });
});

describe('bridge settings from the status page', () => {
  it('pause rejects agent commands but still answers internal ones', async () => {
    const bridge = await startBridge();
    await bridge.set('cfg_paused', '1');
    const res = await bridge.send('get_project_info', {}, A);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/paused by user/i);
    expect((await bridge.send('_session', {}, A)).success).toBe(true);

    await bridge.set('cfg_paused', '0');
    expect((await bridge.send('get_project_info', {}, A)).success).toBe(true);
  });

  it('read-only mode allows inspection and blocks edits', async () => {
    const bridge = await startBridge();
    await bridge.set('cfg_readonly', '1');
    expect((await bridge.send('list_tracks')).success).toBe(true);
    const edit = await bridge.send('set_track_property', { trackIndex: 0, property: 'mute', value: 1 });
    expect(edit.success).toBe(false);
    expect(edit.error).toMatch(/read-only mode/i);

    const { settings } = await bridge.status();
    expect(settings).toMatchObject({ readonly: true, paused: false });
  });

  it('reports setup health', async () => {
    const { health } = await (await startBridge()).status();
    // The fake has no SWS and no Effects/reaper-mcp/ JSFX
    expect(health).toMatchObject({ sws: false, jsfx: false, outdated: false });
  });
});

// REAPER 7.03+: set_action_options lets the script restart itself by running its own action
const SELF_RESTART = `
  api.set_action_options = function(flags) action_options = flags end
  api.get_action_context = function() return false, "${SCRIPTS}mcp_bridge.lua", 0, 55555 end
  api.Main_OnCommand = function(id) ran_command = id end
`;

describe('restart and update requests from the page', () => {
  it('restarts only for a request carrying this run\'s token', async () => {
    const bridge = await startBridge(SELF_RESTART);
    const { control } = await bridge.status();
    expect(control).toMatchObject({ canRestart: true, canUpdate: false });
    expect(control.token).toMatch(/^[0-9a-f]{16}$/);
    expect(await bridge.eval('action_options')).toBe(1); // re-running the script stops it

    await bridge.set('request', 'restart-0123456789abcdef');
    await bridge.status();
    expect(await bridge.eval('ran_command')).toBeNull();
    expect(await bridge.ext('request')).toBeNull(); // consumed either way

    expect(await bridge.eval('action_options')).toBe(1);

    await bridge.set('request', `restart-${control.token}`);
    await bridge.status();
    expect(await bridge.eval('action_options')).toBe(3); // this re-run starts the installed copy again
    expect(await bridge.eval('ran_command')).toBe(55555);
  });

  // setup wrote mcp_update.conf for a developer clone; the clone has scripts/update.sh
  const DEV_CLONE = {
    '/clone/scripts/update.sh': '',
    [`${SCRIPTS}mcp_update.conf`]: 'repo=/clone\nnode=/usr/local/bin/node\ndev=1\n',
  };

  it('developer mode follows setup until the page chooses, and rebuilds the working tree', async () => {
    const bridge = await startBridge('os.execute = function(cmd) executed = cmd return true end', DEV_CLONE);
    let status = await bridge.status();
    expect(status.control.canUpdate).toBe(true);
    expect(status.settings.dev).toBe(true);

    await bridge.set('request', `rebuild-${status.control.token}`);
    await bridge.status(); // requests are handled after the tick's publish: the next one shows it
    status = await bridge.status();
    expect(status.control.update).toMatchObject({ kind: 'rebuild', state: 'running' });
    expect(await bridge.eval('executed')).toContain('./scripts/update.sh --rebuild');

    await bridge.set('cfg_dev', '0');
    expect((await bridge.status()).settings.dev).toBe(false);
  });

  it('reports source changes since the last install only in developer mode', async () => {
    const exec = 'os.execute = function(cmd) executed = cmd return true end';
    const clean = await startBridge(exec, DEV_CLONE);
    expect((await clean.status()).control.changed).toBe(false);
    expect(await clean.eval('executed')).toMatch(/find .* -newer '.*mcp_update\.conf' -print -quit/);

    // the background find left a match from its last run
    const edited = await startBridge(exec, { ...DEV_CLONE, source_changes: 'apps/bridge-ui/src/App.tsx\n' });
    expect((await edited.status()).control.changed).toBe(true);

    const user = await startBridge(exec, { ...DEV_CLONE, [`${SCRIPTS}mcp_update.conf`]: 'repo=/clone\ndev=0\n', source_changes: 'x\n' });
    expect((await user.status()).control.changed).toBe(false);
    expect(await user.eval('executed')).toBeNull();
  });

  it('offers no restart on REAPER without set_action_options', async () => {
    const { control } = await (await startBridge('api.set_action_options = false')).status();
    expect(control.canRestart).toBe(false);
  });
});

// REAPER's EnumInstalledFX(i) -> ok, name, ident; false past the end
const INSTALLED = `
  local installed = { { "VST3: Pro-Q 3 (FabFilter)", "Pro-Q 3.vst3" }, { "JS: Dynamics/1175_compressor", "Dynamics/1175_compressor" }, { "AU: Helix Native (Line 6)", "" }, { "JS: 3o.gfxlib.jsfx-inc", "3o.gfxlib.jsfx-inc" }, { "VST3i: Kontakt 7 (Native Instruments) (64 out)", "" } }
  api.EnumInstalledFX = function(i)
    local fx = installed[i + 1]
    if not fx then return false end
    return true, fx[1], fx[2]
  end
`;

describe('installed FX', () => {
  it('lists what REAPER has installed, not the FX browser folders', async () => {
    const bridge = await startBridge(INSTALLED);
    const res = (await bridge.send('list_available_fx')) as { success: boolean; data?: { fxList: Array<{ name: string; type: string; path: string }>; total: number; source: string } };
    expect(res.data).toMatchObject({ total: 4, source: 'reaper' });
    expect(res.data?.fxList[0]).toEqual({ name: 'VST3: Pro-Q 3 (FabFilter)', type: 'VST3', path: 'Pro-Q 3.vst3' });

    const au = (await bridge.send('list_available_fx', { category: 'au' })) as { data?: { fxList: Array<{ name: string }> } };
    expect(au.data?.fxList.map((f) => f.name)).toEqual(['AU: Helix Native (Line 6)']);
  });

  it('says so when this REAPER cannot enumerate FX', async () => {
    const bridge = await startBridge('api.EnumInstalledFX = false');
    const res = (await bridge.send('list_available_fx')) as { data?: { total: number; source: string; warning?: string } };
    expect(res.data).toMatchObject({ total: 0, source: 'none' });
    expect(res.data?.warning).toMatch(/6\.37/);
  });

  it('publishes the installed list for the status page', async () => {
    const bridge = await startBridge(INSTALLED);
    await bridge.status();
    const feed = JSON.parse((await bridge.ext('installed')) as string);
    expect(feed).toEqual({
      v: 1,
      supported: true,
      fx: [
        { n: 'VST3: Pro-Q 3 (FabFilter)', t: 'VST3' },
        { n: 'JS: Dynamics/1175_compressor', t: 'JS' },
        { n: 'AU: Helix Native (Line 6)', t: 'AU' },
        { n: 'VST3i: Kontakt 7 (Native Instruments) (64 out)', t: 'VST3' },
      ],
    });
  });
});

describe('FX used in the project', () => {
  it('counts each plugin across the project, by its own name', async () => {
    const bridge = await startBridge(`
      api.tracks[1].fx = { { name = "VST3: Pro-Q 3 (FabFilter)" }, { name = "ReaComp" }, { name = "VST3: Pro-Q 3 (FabFilter)" } }
      -- a renamed instance still counts under the plugin's own name
      api.TrackFX_GetNamedConfigParm = function(tr, i, key)
        if key == "fx_name" and tr.fx[i + 1].name == "ReaComp" then return true, "VST: ReaComp (Cockos)" end
        return false, ""
      end
    `);
    await bridge.status();
    expect(JSON.parse((await bridge.ext('used')) as string)).toEqual({
      v: 1,
      fx: [
        { n: 'VST3: Pro-Q 3 (FabFilter)', c: 2 },
        { n: 'VST: ReaComp (Cockos)', c: 1 },
      ],
    });
  });
});

describe('persistent history', () => {
  const json = async <T,>(bridge: Awaited<ReturnType<typeof startBridge>>, key: string) =>
    JSON.parse((await bridge.ext(key)) as string) as T;
  const total = (rows: Row[]) => rows.reduce((sum, r) => sum + r[1], 0);

  it('survives a bridge restart', async () => {
    const first = await startBridge();
    await first.send('get_project_info', {}, A);
    await first.send('list_tracks', {}, A);
    await first.send('no_such_command', {}, A);
    await first.exit();
    const files = {
      'history_log.jsonl': (await first.file('history_log.jsonl')) as string,
      'history.json': (await first.file('history.json')) as string,
    };
    engine?.global.close();
    engine = undefined;

    const second = await startBridge('', files);
    const { recent } = await second.status();
    expect(recent.map((e) => [e.n, e.c, e.ok])).toEqual([
      [3, 'no_such_command', false],
      [2, 'list_tracks', true],
      [1, 'get_project_info', true],
    ]);
    // The saved log is published when the page asks for it, echoing the request
    await second.set('log_want', '111');
    await second.status();
    const log = await json<{ req: string; entries: Entry[] }>(second, 'log');
    expect(log.req).toBe('111');
    expect(log.entries.map((e) => e.n)).toEqual([3, 2, 1]);
    expect(total((await json<History>(second, 'history')).b)).toBe(3);
    const long = await json<LongHistory>(second, 'history_long');
    expect(long.tiers.map((t) => [t.size, total(t.b)])).toEqual([[60000, 3], [600000, 3]]);

    // Numbering continues, so the page can tell new entries from the saved ones
    await second.send('list_tracks', {}, A);
    expect((await second.status()).recent[0].n).toBe(4);
  });

  it('drops persisted history past retention and caps the saved log', async () => {
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    const old = { n: 1, t: now - 8 * day, c: 'list_tracks', ms: 1, ok: true };
    const lines = [old, ...Array.from({ length: 1200 }, (_, i) => ({ n: i + 2, t: now - 60_000 + i, c: 'list_tracks', ms: 1, ok: true }))];
    const bucket = (size: number, t: number): Row => [Math.floor(t / size), 5, 0, 0, 10];
    const history = {
      v: 1,
      tiers: [
        { size: 10000, b: [bucket(10000, now - 2 * 3600 * 1000), bucket(10000, now - 60_000)] },
        { size: 60000, b: [bucket(60000, now - 2 * day), bucket(60000, now - 60_000)] },
        { size: 600000, b: [bucket(600000, now - 8 * day), bucket(600000, now - 6 * day)] },
      ],
    };
    const bridge = await startBridge('', {
      'history_log.jsonl': lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
      'history.json': JSON.stringify(history),
    });
    await bridge.set('log_want', '1');
    await bridge.status();

    const log = await json<{ entries: Entry[] }>(bridge, 'log');
    expect(log.entries).toHaveLength(1000);
    expect(log.entries[0].n).toBe(1201);
    expect(log.entries.every((e) => e.t > now - 7 * day)).toBe(true);
    // The file is compacted to what is kept
    expect(((await bridge.file('history_log.jsonl')) as string).trim().split('\n')).toHaveLength(1000);

    expect(total((await json<History>(bridge, 'history')).b)).toBe(5);
    const long = await json<LongHistory>(bridge, 'history_long');
    expect(long.tiers.map((t) => [t.size, total(t.b)])).toEqual([[60000, 5], [600000, 5]]);
  });

  it('keeps numbering after a week without REAPER, when the saved log has expired', async () => {
    const old = { n: 800, t: Date.now() - 8 * 24 * 3600 * 1000, c: 'list_tracks', ms: 1, ok: true };
    const bridge = await startBridge('', {
      'history_log.jsonl': JSON.stringify(old) + '\n',
      'history.json': JSON.stringify({ v: 1, seq: 800, tiers: [] }),
    });
    await bridge.send('list_tracks', {}, A);
    expect((await bridge.status()).recent.map((e) => e.n)).toEqual([801]);
  });

  it('publishes the saved log only when asked', async () => {
    const bridge = await startBridge();
    await bridge.send('list_tracks', {}, A);
    await bridge.status();
    expect(await bridge.ext('log')).toBeNull();
  });
});

describe('stuck web-server sockets', () => {
  // A controllable clock, a fake lsof that reports `STUCK`, and no window opened on start
  const SETUP = `
    skew = 0
    api.time_precise = function() return os.clock() + skew end
    ext["MCPBridge/cfg_open_on_start"] = "0"
    console = ""
    api.ShowConsoleMsg = function(m) console = console .. m end
    lsof_calls = {}
    STUCK = "85"
    os.execute = function(cmd)
      lsof_calls[#lsof_calls + 1] = cmd
      local f = io.open("${BRIDGE_DIR}web_sockets", "w"); f:write(STUCK .. "\\n"); f:close()
      return true
    end
  `;
  const INI = (cnt: number) => ({ '/reaper/reaper.ini': `[REAPER]\ncsurf_0=HTTP 0 8099 '' 'mcp_bridge.html' 0 ''\ncsurf_cnt=${cnt}\n` });

  it('counts them in the background and reports them, warning once in the console near the limit', async () => {
    const bridge = await startBridge(SETUP, INI(1));
    expect((await bridge.status()).web).toBeUndefined(); // the first count is still running
    expect(await bridge.eval('lsof_calls[1]')).toContain('-iTCP:8099');
    await bridge.eval('(function() skew = 31 end)()');
    await bridge.status(); // this tick reads the count; the next one publishes it
    expect((await bridge.status()).web).toEqual({ stuck: 85, limit: 100 });
    expect(await bridge.eval('console')).toBe('');

    await bridge.eval('(function() STUCK = "95"; skew = 62 end)()');
    await bridge.status();
    await bridge.eval('(function() skew = 93 end)()');
    await bridge.status();
    expect((await bridge.status()).web).toEqual({ stuck: 95, limit: 100 });
    expect(await bridge.eval('console')).toContain('Restart REAPER');
  });

  it('ignores a count left by an earlier REAPER run', async () => {
    const bridge = await startBridge(`${SETUP} os.execute = function() return true end`, { ...INI(1), web_sockets: '99\n' });
    await bridge.eval('(function() skew = 31 end)()');
    await bridge.status();
    expect((await bridge.status()).web).toBeUndefined();
  });

  it('does nothing when the web interface is past csurf_cnt, which REAPER ignores', async () => {
    const bridge = await startBridge(SETUP, INI(0));
    await bridge.eval('(function() skew = 31 end)()');
    expect((await bridge.status()).web).toBeUndefined();
    expect(await bridge.eval('#lsof_calls')).toBe(0);
  });
});
