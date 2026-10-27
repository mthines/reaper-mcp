/**
 * The whole mcp_bridge.lua, run in real Lua 5.4 (wasmoon) against the fake
 * ReaScript API, driven only through its file-IPC contract: write
 * command_{id}.json + _notify, let one defer tick run, read response_{id}.json.
 * Nothing here reaches into the bridge's internals, so tests survive refactors.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory, type LuaEngine } from 'wasmoon';

const REAPER_DIR = join(__dirname, '../../../reaper');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_reaper.lua'), 'utf8');
const SCRIPTS = '/reaper/Scripts/';
const BRIDGE_DIR = `${SCRIPTS}mcp_bridge_data/`;
const LIBS = ['mcp_plan_lib.lua', 'mcp_actions_lib.lua', 'mcp_tracks_lib.lua', 'mcp_project_lib.lua', 'mcp_items_lib.lua'];

interface BridgeResponse {
  id: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

interface Bridge {
  send(type: string, params?: Record<string, unknown>): Promise<BridgeResponse>;
  /** Run Lua against the booted bridge: stub an API on `reaper` or read fake state back. */
  lua(code: string): Promise<unknown>;
}

let engine: LuaEngine | undefined;

afterEach(() => {
  engine?.global.close();
  engine = undefined;
});

/**
 * Boot the bridge against a fake REAPER. `spec` is a Lua table literal for
 * new_fake{}; `playState` is GetPlayState()'s bitmask (1 play, 2 pause, 4 record).
 */
async function startBridge(spec = '{}', playState = 0): Promise<Bridge> {
  const factory = new LuaFactory();
  await factory.mountFile(`${SCRIPTS}mcp_bridge.lua`, readFileSync(join(REAPER_DIR, 'mcp_bridge.lua'), 'utf8'));
  for (const lib of LIBS) await factory.mountFile(SCRIPTS + lib, readFileSync(join(REAPER_DIR, lib), 'utf8'));
  await factory.mountFile(`${BRIDGE_DIR}.keep`, '');

  const lua = await factory.createEngine();
  engine = lua;
  await lua.doString(FAKE_SRC);
  await lua.doString(`
    local api = new_fake(${spec})
    api.GetResourcePath = function() return "/reaper" end
    api.GetPlayState = function() return ${playState} end
    api.GetPlayPosition = function() return api.GetCursorPosition() end
    api.GetProjectPath = function() return "/reaper/projects" end
    api.get_ini_file = function() return "/reaper/reaper.ini" end -- absent: no web UI, no window
    api.time_precise = os.clock
    api.defer = function(fn) next_tick = fn end
    -- Any API the scenario doesn't care about (ExtState, console, atexit, ...) is a no-op.
    reaper = setmetatable(api, { __index = function() return function() end end })
    dofile("${SCRIPTS}mcp_bridge.lua")
  `);

  let seq = 0;
  return {
    async send(type, params = {}) {
      const id = `t${++seq}`;
      const command = JSON.stringify({ id, type, params });
      lua.global.set('CMD', command);
      const response: string | null = await lua.doString(`
        local f = assert(io.open("${BRIDGE_DIR}command_${id}.json", "w")); f:write(CMD); f:close()
        f = assert(io.open("${BRIDGE_DIR}_notify", "w")); f:write("${id}\\n"); f:close()
        next_tick()
        f = io.open("${BRIDGE_DIR}response_${id}.json", "r")
        if not f then return nil end
        local body = f:read("a"); f:close()
        return body
      `);
      expect(response, `bridge answered ${type}`).toBeTruthy();
      return JSON.parse(response as string) as BridgeResponse;
    },
    lua: (code) => lua.doString(code),
  };
}

describe('mcp_bridge.lua over file IPC', () => {
  it('answers each command with a response carrying the same id', async () => {
    const bridge = await startBridge();
    const res = await bridge.send('get_project_info');
    expect(res).toMatchObject({ id: 't1', success: true });
  });

  it('rejects an unknown command type without crashing the loop', async () => {
    const bridge = await startBridge();
    const bad = await bridge.send('no_such_command');
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/unknown command type/i);

    const next = await bridge.send('get_project_info');
    expect(next.success).toBe(true);
  });

  describe('time signature', () => {
    // 7/8 at 96 BPM: numerator, denominator and tempo are all distinct, so a
    // swapped or shifted value can't pass by coincidence (4/4 at 120 would hide it).
    const SEVEN_EIGHT = '{ project = { tempo = 96, num = 7, den = 8 } }';

    it('get_project_info reports the project time signature and tempo separately', async () => {
      const { data } = await (await startBridge(SEVEN_EIGHT)).send('get_project_info');
      expect(data).toMatchObject({ tempo: 96, timeSignatureNumerator: 7, timeSignatureDenominator: 8 });
    });

    it('get_transport_state reports the project time signature and tempo separately', async () => {
      const { data } = await (await startBridge(SEVEN_EIGHT)).send('get_transport_state');
      expect(data).toMatchObject({ tempo: 96, timeSignatureNumerator: 7, timeSignatureDenominator: 8 });
    });

    it('get_tempo_map falls back to the project time signature when there are no markers', async () => {
      const { data } = await (await startBridge(SEVEN_EIGHT)).send('get_tempo_map');
      expect(data?.markers).toEqual([expect.objectContaining({ bpm: 96, timeSigNumerator: 7, timeSigDenominator: 8 })]);
    });
  });

  describe('MIDI channel-event counts (issue #22)', () => {
    // MIDI_CountEvts' "cc" count is every channel event MIDI_GetCC reads, so
    // ccCount must count only real CCs (0xB0) and report the rest separately.
    const MIXED = `{
      tracks = { { name = "Keys", items = 1 } },
      midi = { { { notes = 0, events = {
        { 176, 0, 1, 64 }, { 176, 0, 7, 100 }, { 176, 0, 64, 127 },
        { 224, 0, 0, 64 }, { 192, 0, 5, 0 }, { 208, 0, 90, 0 }, { 160, 0, 60, 80 },
      } } } },
    }`;
    const BREAKDOWN = { cc: 3, pitchBend: 1, programChange: 1, channelPressure: 1, polyAftertouch: 1, other: 0 };
    const ITEM = { trackIndex: 0, itemIndex: 0 };

    it('list_midi_items counts only CC messages as ccCount', async () => {
      const { data } = await (await startBridge(MIXED)).send('list_midi_items', { trackIndex: 0 });
      expect(data?.items).toEqual([
        expect.objectContaining({ ccCount: 3, channelEventCount: 7, channelEventCounts: BREAKDOWN }),
      ]);
    });

    it('get_midi_item_properties counts only CC messages as ccCount', async () => {
      const { data } = await (await startBridge(MIXED)).send('get_midi_item_properties', ITEM);
      expect(data).toMatchObject({ ccCount: 3, channelEventCount: 7, channelEventCounts: BREAKDOWN });
    });

    it('ccCount agrees with the events get_midi_cc returns', async () => {
      const bridge = await startBridge(MIXED);
      const cc = await bridge.send('get_midi_cc', ITEM);
      const props = await bridge.send('get_midi_item_properties', ITEM);
      expect(props.data?.ccCount).toBe(cc.data?.total);
    });

    it('analyze_midi reports totalCC as CC messages only', async () => {
      const { data } = await (await startBridge(MIXED)).send('analyze_midi', ITEM);
      expect(data).toMatchObject({ totalCC: 3, channelEventCount: 7, channelEventCounts: BREAKDOWN });
    });

    it('insert_midi_cc returns the CC count after the insert', async () => {
      const { data } = await (await startBridge(MIXED)).send('insert_midi_cc', {
        ...ITEM, ccNumber: 11, value: 90, position: 0,
      });
      expect(data).toMatchObject({ ccCount: 4, channelEventCount: 8 });
    });

    it('delete_midi_cc deletes by channel-event index and returns both counts', async () => {
      // Index 3 is the pitch bend: ccIndex addresses every channel event, as get_midi_cc reports it.
      const { data } = await (await startBridge(MIXED)).send('delete_midi_cc', { ...ITEM, ccIndex: 3 });
      expect(data).toMatchObject({ ccCount: 3, channelEventCount: 6 });
    });

    it('delete_midi_cc names channel events when the index is out of range', async () => {
      const res = await (await startBridge(MIXED)).send('delete_midi_cc', { ...ITEM, ccIndex: 7 });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/out of range \(item has 7 channel events\)/);
    });
  });

  it('get_project_info reports the session it is looking at', async () => {
    const bridge = await startBridge('{ tracks = { { name = "Kick" }, { name = "Snare" } }, cursor = 12.5 }');
    const { data } = await bridge.send('get_project_info');
    expect(data).toMatchObject({ trackCount: 2, cursorPosition: 12.5, sampleRate: 44100, isPlaying: false });
  });

  it.each([
    [0, { playing: false, paused: false, recording: false }],
    [1, { playing: true, paused: false, recording: false }],
    [2, { playing: false, paused: true, recording: false }],
    [5, { playing: true, paused: false, recording: true }],
  ])('get_transport_state decodes play state %i', async (playState, expected) => {
    const { data } = await (await startBridge('{}', playState)).send('get_transport_state');
    expect(data).toMatchObject(expected);
  });

  // Without CF_Json_Parse (SWS has none) the command decoder keeps a nested
  // array as its raw JSON text; batch handlers must still decode it.
  describe('batch commands carrying arrays', () => {
    const TWO_TRACKS = '{ tracks = { { name = "Kick", fx = { "ReaEQ" } }, { name = "Snare", fx = { "ReaComp" } } } }';

    it('set_multiple_track_properties applies every entry', async () => {
      const bridge = await startBridge(TWO_TRACKS);
      const res = await bridge.send('set_multiple_track_properties', {
        tracks: [{ trackIndex: 0, pan: -0.5 }, { trackIndex: 1, mute: 1 }],
      });
      expect(res.data).toMatchObject({ updated: 2, total: 2 });
      expect(await bridge.lua('return reaper.tracks[1].vals.D_PAN')).toBe(-0.5);
      expect(await bridge.lua('return reaper.tracks[2].vals.B_MUTE')).toBe(1);
    });

    it('set_multiple_fx_parameters applies every entry', async () => {
      const bridge = await startBridge(TWO_TRACKS);
      const res = await bridge.send('set_multiple_fx_parameters', {
        updates: [
          { trackIndex: 0, fxIndex: 0, paramIndex: 2, value: 0.25 },
          { trackIndex: 1, fxIndex: 0, paramIndex: 0, value: 0.75 },
        ],
      });
      expect(res.data).toMatchObject({ updated: 2, total: 2 });
      expect(await bridge.lua('return reaper.tracks[1].fx[1].params[2]')).toBe(0.25);
      expect(await bridge.lua('return reaper.tracks[2].fx[1].params[0]')).toBe(0.75);
    });

    it('setup_fx_chain sets each plugin\'s initial parameters', async () => {
      const bridge = await startBridge('{ tracks = { { name = "Vox" } } }');
      const res = await bridge.send('setup_fx_chain', {
        trackIndex: 0,
        plugins: [{ fxName: 'ReaEQ', parameters: [{ index: 1, value: 0.5 }] }, { fxName: 'ReaComp' }],
      });
      expect(res.data).toMatchObject({ added: 2, total: 2 });
      expect(res.data?.errors).toBeUndefined();
      expect(await bridge.lua('return reaper.tracks[1].fx[1].params[1]')).toBe(0.5);
    });

    it('insert_envelope_points inserts every point of the JSON string', async () => {
      const bridge = await startBridge('{ tracks = { { name = "Pad" } } }');
      await bridge.lua(`
        local env = { points = {} }
        reaper.CountTrackEnvelopes = function() return 1 end
        reaper.GetTrackEnvelope = function() return env end
        reaper.InsertEnvelopePoint = function(e, t, v) e.points[#e.points + 1] = { t, v } end
        reaper.CountEnvelopePoints = function(e) return #e.points end
      `);
      const res = await bridge.send('insert_envelope_points', {
        trackIndex: 0,
        envelopeIndex: 0,
        points: JSON.stringify([{ time: 0, value: 1 }, { time: 2, value: 0.5, shape: 2 }]),
      });
      expect(res.data).toMatchObject({ insertedPoints: 2, totalPoints: 2 });
    });
  });

  it('read_track_lufs gives each track its own raw meter slot and reads that slot', async () => {
    const tracks = Array.from({ length: 140 }, (_, i) => `{ name = "T${i}" }`).join(', ');
    const bridge = await startBridge(`{ tracks = { ${tracks} } }`);
    await bridge.lua(`
      reaper.TrackFX_GetParam = function(tr, fx, p) return tr.fx[fx + 1].params[p] or 0 end
      -- The meter writes its readings at gmem[slot * 8 ...], slot being the raw slider value
      reaper.gmem_read = function(i)
        local slot = reaper.tracks[139].fx[#reaper.tracks[139].fx].params[1]
        if slot and i == slot * 8 then return -14 end
        if slot and i == slot * 8 + 5 then return 3 end
        return 0
      end
    `);
    const res = await bridge.send('read_track_lufs', { trackIndex: 138 });
    expect(res.success, res.error).toBe(true);
    expect(res.data).toMatchObject({ integrated: -14, duration: 3, measuring: true });
    expect(await bridge.lua('return reaper.tracks[139].fx[#reaper.tracks[139].fx].params[1]')).toBe(139);
  });

  describe('create_track_envelope', () => {
    // REAPER's chunk names: VOLENV2/PANENV2/WIDTHENV2 are the normal envelopes,
    // VOLENV/PANENV/WIDTHENV their Pre-FX twins, VOLENV3 Trim Volume.
    const ENVELOPE_API = `
      local by_name = {
        ["Volume"] = "<VOLENV2", ["Volume (Pre-FX)"] = "<VOLENV", ["Trim Volume"] = "<VOLENV3",
        ["Pan"] = "<PANENV2", ["Pan (Pre-FX)"] = "<PANENV", ["Width"] = "<WIDTHENV2", ["Mute"] = "<MUTEENV",
      }
      local function find(tr, chunk_name)
        if tr.chunk:find(chunk_name .. "\\n", 1, true) then return { track = tr, name = chunk_name } end
      end
      reaper.GetTrackEnvelopeByChunkName = find
      reaper.GetTrackEnvelopeByName = function(tr, name) return by_name[name] and find(tr, by_name[name]) end
      reaper.CountTrackEnvelopes = function() return 0 end
      reaper.CountEnvelopePoints = function() return 0 end
    `;

    // REAPER drops an envelope block with no points, so each gets one neutral
    // point at 0 (verified live: 1 = unity volume/width, unmuted; pan 0 = center).
    it.each([
      ['Volume', '<VOLENV2', 'PT 0 1 0'],
      ['Pan', '<PANENV2', 'PT 0 0 0'],
      ['Width', '<WIDTHENV2', 'PT 0 1 0'],
      ['Trim Volume', '<VOLENV3', 'PT 0 1 0'],
      ['Mute', '<MUTEENV', 'PT 0 1 0'],
    ])('%s creates the %s envelope with a neutral point', async (envelopeName, chunkName, point) => {
      const bridge = await startBridge('{ tracks = { { name = "Pad" } } }');
      await bridge.lua(ENVELOPE_API);
      const res = await bridge.send('create_track_envelope', { trackIndex: 0, envelopeName });
      expect(res.success, res.error).toBe(true);
      expect(res.data).toMatchObject({ name: envelopeName });
      const chunk = (await bridge.lua('return reaper.tracks[1].chunk')) as string;
      expect(chunk.slice(chunk.indexOf(`${chunkName}\n`)).split('>')[0]).toContain(`\n${point}\n`);
    });

    it('reports a failure when REAPER drops the envelope', async () => {
      const bridge = await startBridge('{ tracks = { { name = "Pad" } } }');
      await bridge.lua(`
        ${ENVELOPE_API}
        reaper.GetTrackEnvelopeByName = function() return nil end
      `);
      const res = await bridge.send('create_track_envelope', { trackIndex: 0, envelopeName: 'Volume' });
      expect(res.success).toBe(false);
      expect(await bridge.lua('return reaper.begins - reaper.ends')).toBe(0);
    });

    it('refuses an FX index the track does not have, without leaving an undo block open', async () => {
      const bridge = await startBridge('{ tracks = { { name = "Pad", fx = { "ReaEQ" } } } }');
      const res = await bridge.send('create_track_envelope', { trackIndex: 0, fxIndex: 3, paramIndex: 0 });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/FX index 3 out of range/);
      expect(await bridge.lua('return reaper.begins - reaper.ends')).toBe(0);
    });

    it('creates an FX parameter envelope', async () => {
      const bridge = await startBridge('{ tracks = { { name = "Pad", fx = { "ReaEQ" } } } }');
      await bridge.lua(`
        ${ENVELOPE_API}
        reaper.TrackFX_GetNumParams = function() return 4 end
        reaper.GetFXEnvelope = function(tr, fx, p, create) return create and { fx = fx, p = p } or nil end
        reaper.TrackFX_GetParamName = function() return true, "Gain" end
      `);
      const res = await bridge.send('create_track_envelope', { trackIndex: 0, fxIndex: 0, paramIndex: 2 });
      expect(res.success, res.error).toBe(true);
      expect(res.data).toMatchObject({ name: 'ReaEQ / Gain' });
      expect(await bridge.lua('return reaper.begins - reaper.ends')).toBe(0);
    });
  });
});
