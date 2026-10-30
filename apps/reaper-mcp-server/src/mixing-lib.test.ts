/**
 * Behaviour tests for reaper/mcp_mixing_lib.lua, run in real Lua 5.4 (wasmoon) against
 * the fake API in __fixtures__/fake_mixing.lua. Assertions live in the Lua snippets: a
 * failed `assert` rejects the promise.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_mixing_lib.lua'), 'utf8');
const PLAN_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_plan_lib.lua'), 'utf8');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_mixing.lua'), 'utf8');

const factory = new LuaFactory();

const PRELUDE = `
resolve = plan.resolve_track
-- A refusal: no result, an error matching the pattern, and nothing written
function refused(api, pattern, r, err)
  assert(r == nil, "expected a refusal")
  assert(tostring(err):find(pattern), "error was: " .. tostring(err))
  assert(api.writes == 0, "a refusal wrote " .. api.writes .. " times")
end
`;

async function runLua(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    lua.global.set('PLAN_SRC', PLAN_SRC);
    await lua.doString(FAKE_SRC);
    await lua.doString(`mix = load(LIB_SRC, "mcp_mixing_lib.lua")()\nplan = load(PLAN_SRC, "mcp_plan_lib.lua")()\n${PRELUDE}\n${snippet}`);
  } finally {
    lua.global.close();
  }
}

describe('mcp_mixing_lib.lua: automation mode', () => {
  it('sets the mode of tracks by name and index in one undo point, reporting the mode before', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Vox" }, { name = "Bass", automode = 1 } } }
      local r, err = mix.set_automation_mode(api, resolve, { tracks = { "Vox", 1 }, mode = "latch" })
      assert(r, tostring(err))
      assert(r.tracks[1].name == "Vox" and r.tracks[1].before == "trim" and r.tracks[1].mode == "latch")
      assert(r.tracks[2].before == "read" and r.tracks[2].mode == "latch")
      assert(api.tracks[1].automode == 4 and api.tracks[2].automode == 4)
      assert(#api.undo == 1 and api.undo[1] == "MCP: Set automation mode")
      assert(r.globalOverride == "none")
    `);
  });

  it('sets and clears the global override without touching any track', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Vox", automode = 3 } } }
      local r = mix.set_automation_mode(api, resolve, { globalOverride = "bypass" })
      assert(r.globalOverrideBefore == "none" and r.globalOverride == "bypass" and api.override == 6)
      assert(#r.tracks == 0 and api.tracks[1].automode == 3)
      r = mix.set_automation_mode(api, resolve, { globalOverride = "none" })
      assert(r.globalOverride == "none" and api.override == -1)
    `);
  });

  it('refuses an unknown mode or an unknown track and changes nothing', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Vox" } } }
      refused(api, "Unknown mode", mix.set_automation_mode(api, resolve, { tracks = { 0 }, mode = "auto" }))
      refused(api, "not found", mix.set_automation_mode(api, resolve, { tracks = { 0, "Drums" }, mode = "write" }))
      assert(api.tracks[1].automode == 0)
    `);
  });
});

describe('mcp_mixing_lib.lua: FX parameter modulation', () => {
  it('turns on an LFO and reads it back, with the state before (none)', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Synth", fx = { { name = "ReaEQ" } } } } }
      local r, err = mix.set_modulation(api, { trackIndex = 0, fxIndex = 0, paramIndex = 1 },
        { baseline = 0.4, lfo = { shape = "triangle", speed = 2, strength = 0.25 } })
      assert(r, tostring(err))
      assert(r.before == nil, "no modulation before")
      local m = r.modulation
      assert(m.paramIndex == 1 and m.name == "P1" and m.baseline == 0.4)
      assert(m.lfo.shape == "triangle" and m.lfo.speed == 2 and m.lfo.strength == 0.25)
      assert(m.audio == nil and m.link == nil)
      assert(#api.undo == 1)
      local list = mix.get_modulation(api, { trackIndex = 0, fxIndex = 0 })
      assert(#list.modulated == 1 and list.modulated[1].paramIndex == 1, "only the modulated parameter is listed")
    `);
  });

  it('links a parameter to another FX parameter, naming the source', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Bus", fx = { { name = "ReaEQ" }, { name = "ReaComp" } } } } }
      local r, err = mix.set_modulation(api, { trackIndex = 0, fxIndex = 1, paramIndex = 0 },
        { link = { fxIndex = 0, paramIndex = 2, scale = -0.5, offset = 0.1 } })
      assert(r, tostring(err))
      local l = r.modulation.link
      assert(l.fxIndex == 0 and l.paramIndex == 2 and l.fxName == "ReaEQ" and l.paramName == "P2")
      assert(l.scale == -0.5 and l.offset == 0.1)
    `);
  });

  it('a modulation REAPER refuses half way is undone, not left half applied', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { fx = { {} } } } }
      local set = api.TrackFX_SetNamedConfigParm
      api.TrackFX_SetNamedConfigParm = function(tr, i, key, v)
        if key:find("lfo.speed") then return false end
        return set(tr, i, key, v)
      end
      local ok, err = pcall(mix.set_modulation, api, { trackIndex = 0, fxIndex = 0, paramIndex = 0 }, { lfo = { shape = "sine", speed = 2 } })
      assert(not ok and tostring(err):find("the edit was undone"), tostring(err))
      assert(next(api.tracks[1].fx[1].cfg) == nil, "no modulation key left behind")
    `);
  });

  it('turns modulation off again', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { fx = { {} } } } }
      mix.set_modulation(api, { trackIndex = 0, fxIndex = 0, paramIndex = 0 }, { lfo = { shape = "sine" } })
      local r = mix.set_modulation(api, { trackIndex = 0, fxIndex = 0, paramIndex = 0 }, { enabled = false })
      assert(r.before.lfo.shape == "sine")
      assert(r.modulation.enabled == false)
      assert(#mix.get_modulation(api, { trackIndex = 0, fxIndex = 0 }).modulated == 0)
    `);
  });

  it('refuses a bad shape, a self-link, a link to a missing FX or an audio channel above the track and changes nothing', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { nchan = 2, fx = { {}, {} } } } }
      local p = { trackIndex = 0, fxIndex = 0, paramIndex = 1 }
      refused(api, "Unknown LFO shape", mix.set_modulation(api, p, { lfo = { shape = "wobble" } }))
      refused(api, "itself", mix.set_modulation(api, p, { link = { fxIndex = 0, paramIndex = 1 } }))
      refused(api, "link.fxIndex 5 out of range", mix.set_modulation(api, p, { link = { fxIndex = 5, paramIndex = 0 } }))
      refused(api, "above the track", mix.set_modulation(api, p, { audio = { channel = 3 } }))
      refused(api, "baseline", mix.set_modulation(api, p, { baseline = 2 }))
      refused(api, "out of range", mix.set_modulation(api, { trackIndex = 0, fxIndex = 0, paramIndex = 99 }, { baseline = 0.5 }))
    `);
  });
});

describe('mcp_mixing_lib.lua: FX pins', () => {
  it('reads the pin matrix as channel lists with pin names', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { nchan = 2, fx = { { name = "ReaComp", ins = 4, outs = 2 } } } } }
      local r = mix.get_pins(api, { trackIndex = 0, fxIndex = 0 })
      assert(r.trackChannels == 2 and #r.inputs == 4 and #r.outputs == 2)
      assert(r.inputs[3].channels[1] == 3 and r.inputs[3].name == "in 2", "sidechain pin 2 reads channel 3")
      assert(r.outputs[2].channels[1] == 2)
    `);
  });

  it('routes the sidechain pins to channels 3/4, widening the track to 4 channels', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { nchan = 2, fx = { { name = "ReaComp", ins = 4, outs = 2 } } } } }
      local r, err = mix.set_pins(api, { trackIndex = 0, fxIndex = 0 }, { { pin = 2, channels = { 3 } }, { pin = 3, channels = { 4 } } })
      assert(r, tostring(err))
      assert(r.trackChannels == 4 and r.trackChannelsBefore == 2 and api.tracks[1].nchan == 4)
      assert(r.inputs[3].channels[1] == 3 and r.inputs[4].channels[1] == 4)
      assert(r.before.trackChannels == 2)
      assert(#api.undo == 1)
    `);
  });

  it('maps one pin to several channels and channels above 32', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { nchan = 64, fx = { { ins = 2, outs = 2 } } } } }
      local r = mix.set_pins(api, { trackIndex = 0, fxIndex = 0 }, { { 1, 2 }, { 40 } })
      assert(#r.inputs[1].channels == 2 and r.inputs[2].channels[1] == 40)
      assert(r.trackChannelsBefore == nil, "no widening needed")
    `);
  });

  it('refuses a pin the FX does not have, a channel outside 1..64 or too few track channels and changes nothing', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { nchan = 2, fx = { { ins = 2, outs = 2 } } } } }
      local p = { trackIndex = 0, fxIndex = 0 }
      refused(api, "pin 5 out of range", mix.set_pins(api, p, { { pin = 5, channels = { 1 } } }))
      refused(api, "1..64", mix.set_pins(api, p, { { 65 } }))
      refused(api, "below channel 6", mix.set_pins(api, { trackIndex = 0, fxIndex = 0, trackChannels = 4 }, nil, { { 6 } }))
      refused(api, "FX index 3", mix.set_pins(api, { trackIndex = 0, fxIndex = 3 }, { { 1 } }))
    `);
  });
});

describe('mcp_mixing_lib.lua: monitoring FX', () => {
  it('adds a monitoring FX with parameters, toggles it and removes it, each an undo point', async () => {
    await runLua(`
      local api = new_fake{ tracks = {} }
      local r, err = mix.add_monitoring_fx(api, { fxName = "ReaEQ" }, { { paramIndex = 0, value = 0.25 } })
      assert(r, tostring(err))
      assert(r.fxIndex == 0 and r.name == "ReaEQ" and #r.before == 0 and #r.fx == 1)
      assert(api.master.mon[1].params[1].v == 0.25 and #api.master.fx == 0, "on the monitoring chain, not the master FX")
      r = mix.set_monitoring_fx(api, { fxIndex = 0, enabled = false })
      assert(r.fx[1].enabled == false and r.before[1].enabled == true)
      r = mix.remove_monitoring_fx(api, { fxIndex = 0 })
      assert(r.removed == "ReaEQ" and #r.fx == 0)
      assert(#api.undo == 3)
    `);
  });

  it('refuses an unknown index, an unknown plugin or a bad value and changes nothing', async () => {
    await runLua(`
      local api = new_fake{ tracks = {} }
      refused(api, "out of range", mix.set_monitoring_fx(api, { fxIndex = 0, enabled = true }))
      refused(api, "out of range", mix.remove_monitoring_fx(api, { fxIndex = 2 }))
      local r, err = mix.add_monitoring_fx(api, { fxName = "NoSuchFX" })
      assert(r == nil and err:find("not found"))
      assert(#api.master.mon == 0)
      mix.add_monitoring_fx(api, { fxName = "ReaEQ" })
      api.writes = 0
      refused(api, "0..1", mix.set_monitoring_fx(api, { fxIndex = 0, params = nil }, { { paramIndex = 0, value = 3 } }))
    `);
  });
});

describe('mcp_mixing_lib.lua: freeze and render in place', () => {
  it('freezes the named tracks only, puts the selection back, and unfreezes them', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Synth", fx = { {}, {} }, items = { {} } }, { name = "Pad", selected = true } } }
      local r, err = mix.freeze_tracks(api, resolve, { tracks = { "Synth" }, mode = "mono" })
      assert(r, tostring(err))
      assert(api.actions[1] == 40901, "the freeze-to-mono action")
      assert(r.tracks[1].frozen == 1 and r.tracks[1].before.frozen == 0)
      assert(r.tracks[1].fx == 0 and r.tracks[1].before.fx == 2)
      assert(api.tracks[1].selected == false and api.tracks[2].selected == true, "selection put back")
      assert(api.tracks[2].freezes == 0, "the other track was not frozen")
      r = mix.unfreeze_tracks(api, resolve, { tracks = { 0 } })
      assert(r.tracks[1].frozen == 0 and r.tracks[1].fx == 2)
      assert(#api.undo == 2)
    `);
  });

  it('refuses to unfreeze a track that is not frozen, to freeze the master or an unknown mode, and changes nothing', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Synth" }, { name = "Pad", frozen = 1 } } }
      refused(api, "Not frozen: Synth", mix.unfreeze_tracks(api, resolve, { tracks = { "Pad", "Synth" } }))
      refused(api, "master", mix.freeze_tracks(api, resolve, { tracks = { "master" } }))
      refused(api, "Unknown mode", mix.freeze_tracks(api, resolve, { tracks = { 0 }, mode = "surround" }))
      assert(#api.actions == 0)
    `);
  });

  it('applies track FX to the given items as a new take, keeping the item selection', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Gtr", items = { { name = "riff" }, { name = "solo", selected = true } } } } }
      local r, err = mix.apply_fx_to_items(api, {}, { { trackIndex = 0, itemIndex = 0 } })
      assert(r, tostring(err))
      assert(r.items[1].takes == 2 and r.items[1].before.takes == 1 and r.items[1].activeTake == "riff render")
      assert(api.tracks[1].items[2].takes[2] == nil, "the other item was not rendered")
      assert(api.tracks[1].items[1].selected == false and api.tracks[1].items[2].selected == true)
      refused(new_fake{ tracks = { { items = { {} } } } }, "Item 3 not found", mix.apply_fx_to_items(new_fake{ tracks = { { items = { {} } } } }, {}, { { trackIndex = 0, itemIndex = 3 } }))
    `);
  });
});

describe('mcp_mixing_lib.lua: stretch markers', () => {
  it('adds a batch of stretch markers in one undo point', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { items = { { pos = 2, len = 4 } } } } }
      local r, err = mix.add_stretch_markers(api, { trackIndex = 0, itemIndex = 0 }, { { position = 1 }, { position = 2.5, sourcePosition = 2.4 } })
      assert(r, tostring(err))
      assert(r.added == 2 and #r.markers == 2 and r.markers[2].sourcePosition == 2.4)
      assert(#api.undo == 1)
    `);
  });

  it('refuses a marker outside the item or on a MIDI item and changes nothing', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { items = { { len = 4 }, { midi = true } } } } }
      refused(api, "marker 2: position 5", mix.add_stretch_markers(api, { trackIndex = 0, itemIndex = 0 }, { { position = 1 }, { position = 5 } }))
      refused(api, "MIDI", mix.add_stretch_markers(api, { trackIndex = 0, itemIndex = 1 }, { { position = 1 } }))
    `);
  });

  it('quantizes hits to the grid: markers move onto 8ths, with item-end anchors, and the offsets shrink', async () => {
    await runLua(`
      -- 120 BPM: an 8th (grid 0.5 QN) is 0.25 s. Item at 10 s; hits in source seconds.
      local api = new_fake{ tracks = { { items = { { pos = 10, len = 4 } } } } }
      local r, err = mix.quantize_stretch(api, { trackIndex = 0, itemIndex = 0, grid = 0.5 }, { 0.52, 1.03, 1.47, 3.98 })
      assert(r, tostring(err))
      assert(r.hits == 4, "four hits inside the item: " .. r.hits)
      assert(r.placed == 3 and r.moved == 3 and r.skipped == 1, "3.98 would snap onto the item end and is skipped")
      local sm = api.tracks[1].items[1].takes[1].sm
      assert(#sm == 5, "two anchors plus three hits: " .. #sm)
      assert(sm[1][1] == 0 and sm[5][1] == 4 and sm[5][2] == 4, "anchors at both ends")
      assert(math.abs(sm[2][1] - 0.5) < 1e-9 and sm[2][2] == 0.52, "0.52 → 0.5, source kept")
      assert(math.abs(sm[3][1] - 1.0) < 1e-9 and math.abs(sm[4][1] - 1.5) < 1e-9)
      assert(r.offsetBefore.maxMs == 30 and r.offsetAfter.maxMs == 0)
      assert(#api.undo == 1 and api.undo[1] == "MCP: Quantize audio")
    `);
  });

  it('applies strength and window: half strength moves halfway, far hits stay put', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { items = { { pos = 0, len = 4 } } } } }
      local r = mix.quantize_stretch(api, { trackIndex = 0, itemIndex = 0, grid = 1, strength = 0.5, window = 0.2 }, { 1.04, 1.25 })
      -- grid 1 QN = 0.5 s; window 0.2 reaches 0.05 s. 1.04 moves halfway to 1.0; 1.25 is too far.
      local sm = api.tracks[1].items[1].takes[1].sm
      assert(math.abs(sm[2][1] - 1.02) < 1e-9, "halfway: " .. sm[2][1])
      assert(math.abs(sm[3][1] - 1.25) < 1e-9, "out of reach stays")
      assert(r.moved == 1 and r.placed == 2)
    `);
  });

  it('keeps one marker when two hits land on the same grid line, and replaces old markers', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { items = { { pos = 0, len = 4 } } } } }
      mix.add_stretch_markers(api, { trackIndex = 0, itemIndex = 0 }, { { position = 2 } })
      local r = mix.quantize_stretch(api, { trackIndex = 0, itemIndex = 0, grid = 1 }, { 0.98, 1.03 })
      assert(r.placed == 1 and r.skipped == 1 and r.replacedMarkers == 1)
      assert(#api.tracks[1].items[1].takes[1].sm == 3)
    `);
  });

  it('refuses a quantize with no hit inside the item and keeps the markers the item has', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { items = { { pos = 0, len = 4 } } } } }
      mix.add_stretch_markers(api, { trackIndex = 0, itemIndex = 0 }, { { position = 2 } })
      local writes = api.writes
      local r, err = mix.quantize_stretch(api, { trackIndex = 0, itemIndex = 0, grid = 1 }, { 5, 6 })
      assert(r == nil and err:find("No hits inside the item", 1, true), tostring(err))
      assert(api.writes == writes and #api.tracks[1].items[1].takes[1].sm == 1, "the existing marker stays")
    `);
  });

  it('places markers in take time on an item at another play rate, and reports item seconds', async () => {
    await runLua(`
      -- 2x play rate: source second 1.04 plays at item second 0.52 and snaps to the 8th at 0.5;
      -- REAPER keeps marker positions at rate 1, so that marker sits at 1.0 with its source 1.04
      local api = new_fake{ tracks = { { items = { { pos = 0, len = 2, rate = 2 } } } } }
      local r, err = mix.quantize_stretch(api, { trackIndex = 0, itemIndex = 0, grid = 0.5 }, { 1.04 })
      assert(r, tostring(err))
      local sm = api.tracks[1].items[1].takes[1].sm
      assert(math.abs(sm[2][1] - 1.0) < 1e-9 and sm[2][2] == 1.04, "hit marker: " .. sm[2][1] .. " " .. sm[2][2])
      assert(sm[3][1] == 4 and sm[3][2] == 4, "end anchor at the item end in take time")
      assert(r.moves[1][1] == 0.52 and r.moves[1][2] == 0.5, "moves are item seconds")

      local api2 = new_fake{ tracks = { { items = { { pos = 0, len = 2, rate = 2 } } } } }
      local a = assert(mix.add_stretch_markers(api2, { trackIndex = 0, itemIndex = 0 }, { { position = 1 } }))
      assert(api2.tracks[1].items[1].takes[1].sm[1][1] == 2 and a.markers[1].position == 1)
    `);
  });

  it('refuses a bad grid, strength or a MIDI item and changes nothing', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { items = { { len = 4 }, { midi = true } } } } }
      refused(api, "grid", mix.quantize_stretch(api, { trackIndex = 0, itemIndex = 0, grid = 0 }, {}))
      refused(api, "strength", mix.quantize_stretch(api, { trackIndex = 0, itemIndex = 0, grid = 1, strength = 2 }, {}))
      refused(api, "MIDI", mix.quantize_stretch(api, { trackIndex = 0, itemIndex = 1, grid = 1 }, {}))
    `);
  });
});
