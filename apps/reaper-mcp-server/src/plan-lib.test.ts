/**
 * Unit tests for reaper/mcp_plan_lib.lua, run in real Lua 5.4 (wasmoon)
 * against an in-memory fake of the ReaScript API (__fixtures__/fake_reaper.lua).
 * Assertions live in the Lua snippets: a failed `assert` rejects the promise.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_plan_lib.lua'), 'utf8');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_reaper.lua'), 'utf8');
const ACTIONS_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_actions_lib.lua'), 'utf8');

const factory = new LuaFactory();

async function runLua(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    lua.global.set('ACTIONS_SRC', ACTIONS_SRC);
    await lua.doString(FAKE_SRC);
    await lua.doString(
      `plan = load(LIB_SRC, "mcp_plan_lib.lua")()\nactions = load(ACTIONS_SRC, "mcp_actions_lib.lua")()\n${snippet}`,
    );
  } finally {
    lua.global.close();
  }
}

const TRACK_WITH_ITEMS = [
  '<TRACK',
  '  NAME "Target"',
  '  <FXCHAIN',
  '    SHOW 0',
  '    <VST "VST: ReaEQ (Cockos)" reaeq.dll 0 "" 1919247729',
  '      cmVlcQ==',
  '    >',
  '    FXID {AAAAAAAA-0000-0000-0000-000000000001}',
  '  >',
  '  <ITEM',
  '    POSITION 0',
  '    <SOURCE WAVE',
  '      FILE "kick.wav"',
  '    >',
  '  >',
  '>',
].join('\n');

const SOURCE_CHUNK = [
  '<TRACK',
  '  NAME "Source"',
  '  <FXCHAIN_REC',
  '    FXID {CCCCCCCC-0000-0000-0000-000000000009}',
  '  >',
  '  <FXCHAIN',
  '    SHOW 0',
  '    <VST "VST: Pro-C 2 (FabFilter)" proc2.vst3 0 "" 1',
  '      cHJvYzI=',
  '    >',
  '    FXID {BBBBBBBB-0000-0000-0000-000000000001}',
  '    <JS "utility/volume" ""',
  '      0 - - - -',
  '    >',
  '    FXID {BBBBBBBB-0000-0000-0000-000000000002}',
  '  >',
  '>',
].join('\n');

describe('mcp_plan_lib.lua (wasmoon)', () => {
  it('lua plan: applies multi-op plan in one undo block', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Kick" }, { name = "Snare" } } }
      local res, err = plan.run_plan(api, { ops = {
        { op = "add_track", name = "Drum Bus", as = "$bus" },
        { op = "add_send", from = "Kick", to = "$bus", volume = -3 },
        { op = "add_send", from = "Snare", to = "$bus" },
        { op = "add_fx", track = "$bus", fxName = "ReaComp", as = "$comp" },
        { op = "set_fx_params", fx = "$comp", params = { { index = 0, value = 0.5 } } },
        { op = "set_track", track = "$bus", volume = -6 },
      } }, {})
      assert(err == nil, err)
      assert(res.applied == 6, "applied " .. tostring(res.applied))
      assert(api.begins == 1 and api.ends == 1, "undo blocks: " .. api.begins .. "/" .. api.ends)
      assert(#api.undo == 1, "undo points: " .. #api.undo)
      local bus = api.tracks[3]
      assert(bus.name == "Drum Bus")
      assert(#api.tracks[1].sends == 1 and api.tracks[1].sends[1].dst == bus)
      assert(bus.fx[1].name == "ReaComp" and bus.fx[1].params[0] == 0.5)
      assert(math.abs(bus.vals.D_VOL - 10 ^ (-6 / 20)) < 1e-9)
    `);
  });

  it('lua plan: reverts and names op index on mid-apply failure', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Kick" } }, missing_fx = "Nope", undo = { "User edit" } }
      local res, err = plan.run_plan(api, { ops = {
        { op = "set_track", track = "Kick", volume = -3 },
        { op = "add_fx", track = "Kick", fxName = "Nope" },
      } }, {})
      assert(res == nil, "expected failure")
      assert(err:find("op 1 %(add_fx%)"), err)
      assert(err:find("reverted"), err)
      assert(api.undone == "MCP: run_plan (failed — reverting)", "undone: " .. tostring(api.undone))
      assert(api.undo[#api.undo] == "User edit", "user undo history must survive")

      -- Failure before any write: no undo point exists, so nothing is undone.
      local api2 = new_fake{ tracks = { { name = "Kick" } }, missing_fx = "Nope", undo = { "User edit" } }
      local _, err2 = plan.run_plan(api2, { ops = { { op = "add_fx", track = "Kick", fxName = "Nope" } } }, {})
      assert(err2:find("op 0"), err2)
      assert(api2.undone == nil, "must not undo the user's edit")
      assert(#api2.undo == 1 and api2.undo[1] == "User edit")
    `);
  });

  it('lua plan: aborts without writes on unresolvable or ambiguous track', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Gtr" }, { name = "Gtr" }, { name = "Bass" } } }
      local res, err = plan.run_plan(api, { ops = {
        { op = "set_track", track = "Bass", volume = -1 },
        { op = "set_track", track = "Gtr", volume = -1 },
      } }, {})
      assert(res == nil and err:find("ambiguous"), tostring(err))
      assert(err:find("nothing was changed"), err)

      local _, err2 = plan.run_plan(api, { ops = {
        { op = "set_track", track = "Bass", volume = -1 },
        { op = "set_track", track = "Vocals", volume = -1 },
        { op = "set_track", track = 9, volume = -1 },
        { op = "set_track", track = "{DEADBEEF-0000-0000-0000-000000000000}", volume = -1 },
        { op = "set_track", track = "$nope", volume = -1 },
      } }, {})
      assert(err2:find("op 1") and err2:find("op 2") and err2:find("op 3") and err2:find("op 4"), err2)
      assert(api.writes == 0, "writes: " .. api.writes)
      assert(api.begins == 0, "no undo block may open")
    `);
  });

  it('lua plan: resolves tracks by index, name and guid', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Kick" }, { name = "Snare" }, { name = "Hats" }, { name = "7" } } }
      local hats_guid = api.tracks[3].guid
      local res, err = plan.run_plan(api, { ops = {
        { op = "set_track", track = 0, pan = -0.1 },
        { op = "set_track", track = "Snare", pan = -0.2 },
        { op = "set_track", track = hats_guid, pan = -0.3 },
        { op = "set_track", track = "snare", mute = 1 },
        { op = "set_track", track = "7", pan = -0.4 },
        { op = "set_track", track = "1", solo = 1 },
      } }, {})
      assert(err == nil, err)
      assert(api.tracks[1].vals.D_PAN == -0.1)
      assert(api.tracks[2].vals.D_PAN == -0.2 and api.tracks[2].vals.B_MUTE == 1)
      assert(api.tracks[3].vals.D_PAN == -0.3)
      assert(api.tracks[4].vals.D_PAN == -0.4, "a digit string matches a track name first")
      assert(api.tracks[2].vals.I_SOLO == 1, "a digit string falls back to the index")
    `);
  });

  it('lua plan: dryRun makes no writes', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Kick" } } }
      local res, err = plan.run_plan(api, { dryRun = true, ops = {
        { op = "add_track", name = "Bus", as = "$bus" },
        { op = "add_send", from = "Kick", to = "$bus" },
        { op = "set_track", track = "Missing", volume = 0 },
      } }, {})
      assert(err == nil, err)
      assert(res.dryRun == true and res.valid == false)
      assert(#res.ops == 3 and res.ops[2].op == "add_send")
      assert(#res.conflicts == 1 and res.conflicts[1].op == 2, "conflicts: " .. #res.conflicts)
      assert(api.writes == 0 and api.begins == 0)
      assert(#api.tracks == 1)
    `);
  });

  it('lua plan: add_track with an index past the end names the new last track', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Kick" } } }
      local res, err = plan.run_plan(api, { ops = {
        { op = "add_track", name = "Bus", index = 9, as = "$bus" },
        { op = "set_track", track = "$bus", pan = 0.5 },
      } }, {})
      assert(err == nil, err)
      assert(#api.tracks == 2 and api.tracks[2].name == "Bus", "named: " .. tostring(api.tracks[2].name))
      assert(api.tracks[2].vals.D_PAN == 0.5 and res.results[1].result.track == 1, "bound and reported at index 1")
    `);
  });

  it('lua plan: repeated idempotencyKey is not re-applied', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Kick" } } }
      local ctx = {}
      local p = { idempotencyKey = "abc", ops = { { op = "add_track", name = "Bus" } } }
      local first, err = plan.run_plan(api, p, ctx)
      assert(err == nil, err)
      local second, err2 = plan.run_plan(api, p, ctx)
      assert(err2 == nil, err2)
      assert(second.alreadyApplied == true, "second call must report alreadyApplied")
      assert(second.result == first)
      assert(#api.tracks == 2, "track count: " .. #api.tracks)
      assert(api.begins == 1)
    `);
  });

  it('lua plan: snapshotBefore saves before first write', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Kick" } } }
      local saved_at_writes
      local ctx = { snapshot_save = function(name)
        assert(name == "pre-plan")
        saved_at_writes = api.writes
        return { success = true }
      end }
      local _, err = plan.run_plan(api, { snapshotBefore = "pre-plan",
        ops = { { op = "set_track", track = "Kick", volume = -2 } } }, ctx)
      assert(err == nil, err)
      assert(saved_at_writes == 0, "snapshot must come before any write")
      assert(api.writes == 1)

      local api2 = new_fake{ tracks = { { name = "Kick" } } }
      local _, err2 = plan.run_plan(api2, { snapshotBefore = "x",
        ops = { { op = "set_track", track = "Kick", volume = -2 } } },
        { snapshot_save = function() return nil, "disk full" end })
      assert(err2:find("disk full"), tostring(err2))
      assert(api2.writes == 0)
    `);
  });

  it('lua plan: set_fx_params after graft_fxchain validates against the grafted chain', async () => {
    await runLua(`
      local api = new_fake{ tracks = {
        { name = "Source", chunk = [[${SOURCE_CHUNK}]] },
        { name = "Target", fx = { "VST: ReaEQ (Cockos)" } },
      } }
      local function dry(fx)
        local res = plan.run_plan(api, { dryRun = true, ops = {
          { op = "graft_fxchain", track = "Target", from = "Source" },
          { op = "set_fx_params", track = "Target", fx = fx, params = { { index = 0, value = 0.5 } } },
        } }, {})
        return res.valid, res.conflicts[1] and res.conflicts[1].error
      end
      assert(dry("Pro-C 2"), "a grafted FX by name")
      assert(dry(1), "a grafted FX by index")
      local ok, err = dry(2)
      assert(not ok and err:find("out of range"), tostring(err))
      ok, err = dry("ReaEQ")
      assert(not ok and err:find("not found"), "the replaced FX is gone: " .. tostring(err))
      ok, err = dry("proc2.vst3")
      assert(not ok, "only FX names match, not plugin file names")

      -- A source the plan creates or changes: the target gets what the source will hold.
      local function plan_dry(ops)
        local res = plan.run_plan(api, { dryRun = true, ops = ops }, {})
        return res.valid, res.conflicts[1] and res.conflicts[1].error
      end
      ok, err = plan_dry({
        { op = "add_track", name = "Src", as = "$src" },
        { op = "add_fx", track = "$src", fxName = "ReaComp" },
        { op = "graft_fxchain", track = "Target", from = "$src" },
        { op = "set_fx_params", track = "Target", fx = "ReaComp", params = { { index = 0, value = 0.5 } } },
      })
      assert(ok, "graft from a plan-created track: " .. tostring(err))
      ok, err = plan_dry({
        { op = "add_track", name = "Src", as = "$src" },
        { op = "add_fx", track = "$src", fxName = "ReaComp" },
        { op = "graft_fxchain", track = "Target", from = "$src" },
        { op = "set_fx_params", track = "Target", fx = "ReaEQ", params = { { index = 0, value = 0.5 } } },
      })
      assert(not ok and err:find("not found"), "the graft replaced ReaEQ: " .. tostring(err))
      ok, err = plan_dry({
        { op = "add_fx", track = "Source", fxName = "ReaDelay" },
        { op = "graft_fxchain", track = "Target", from = "Source" },
        { op = "set_fx_params", track = "Target", fx = "ReaDelay", params = { { index = 0, value = 0.5 } } },
      })
      assert(ok, "graft after add_fx on the source: " .. tostring(err))
    `);
  });

  it('lua plan: graft_fxchain splices FXCHAIN, keeps items, regenerates FXIDs', async () => {
    await runLua(`
      local target_chunk = [[${TRACK_WITH_ITEMS}]]
      local source_chunk = [[${SOURCE_CHUNK}]]
      local api = new_fake{ tracks = {
        { name = "Source", chunk = source_chunk },
        { name = "Target", chunk = target_chunk },
      } }
      local _, err = plan.run_plan(api, { ops = {
        { op = "graft_fxchain", track = "Target", from = "Source" },
      } }, {})
      assert(err == nil, err)
      local out = api.tracks[2].chunk
      assert(out:find("Pro%-C 2"), "source FX copied")
      assert(out:find("utility/volume"), "second source FX copied")
      assert(not out:find("ReaEQ"), "old target FXCHAIN replaced")
      assert(out:find('FILE "kick.wav"'), "target items kept")
      assert(out:find('NAME "Target"'), "target name kept")
      assert(not out:find("FXCHAIN_REC"), "input FX chain is not copied")
      assert(not out:find("BBBBBBBB"), "FXIDs regenerated")
      local n = 0
      for _ in out:gmatch("FXID {") do n = n + 1 end
      assert(n == 2, "fxid count " .. n)
      assert(api.tracks[1].chunk == source_chunk, "source untouched")

      -- fromChunk (base64 track chunk) onto a track without an FXCHAIN:
      -- inserted before the first ITEM block.
      local b64 = ${JSON.stringify(Buffer.from(SOURCE_CHUNK).toString('base64'))}
      local api2 = new_fake{ tracks = { { name = "Bare", chunk = '<TRACK\\n  NAME "Bare"\\n  <ITEM\\n    POSITION 1\\n  >\\n>\\n' } } }
      local _, err2 = plan.run_plan(api2, { ops = {
        { op = "graft_fxchain", track = "Bare", fromChunk = b64 },
      } }, {})
      assert(err2 == nil, err2)
      local out2 = api2.tracks[1].chunk
      assert(out2:find("<FXCHAIN") < out2:find("<ITEM"), "FXCHAIN goes before items")
      assert(out2:find("POSITION 1"), "items kept")
    `);
  });

  it('lua plan: string plan without CF_Json_Parse is decoded and applied', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Kick" } } }
      local ops = '[{"op":"add_track","name":"Bus \\\\"A\\\\"","as":"$bus"},'
        .. '{"op":"add_fx","track":"$bus","fxName":"ReaComp","params":[{"index":0,"value":0.5e0}],"enabled":1},'
        .. '{"op":"set_track","track":"Kick","volume":-3.5,"pan":-0.25}]'
      local res, err = plan.run_plan(api, { ops = ops }, {})
      assert(err == nil, err)
      assert(res.applied == 3, "applied " .. tostring(res.applied))
      assert(api.tracks[2].name == 'Bus "A"', "escaped name: " .. tostring(api.tracks[2].name))

      local d = plan.json_decode('{"a":[1,-2.5,true,false,null,"\\\\u00e9\\\\n"],"b":{}}')
      assert(d.a[1] == 1 and d.a[2] == -2.5 and d.a[3] == true and d.a[4] == false)
      assert(d.a[6] == "\\u{e9}\\n" and next(d.b) == nil)

      local json_text = '[{"op":"set_track","track":"Kick","volume":-3}]'
      local api2 = new_fake{ tracks = { { name = "Kick" } }, json = function(s)
        assert(s == json_text, "CF_Json_Parse receives the raw ops string")
        return true, { { op = "set_track", track = "Kick", volume = -3 } }
      end }
      local res2, err2 = plan.run_plan(api2, { ops = json_text }, {})
      assert(err2 == nil, err2)
      assert(res2.applied == 1)
    `);
  });

  it('lua plan: digit-string fx ref falls back to the FX index', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Kick", fx = { "ReaEQ", "Ozone 10" } } } }
      local res, err = plan.run_plan(api, { ops = {
        { op = "set_fx_params", track = "Kick", fx = "0", params = { { index = 3, value = 0.5 } } },
      } }, {})
      assert(err == nil, err)
      local fx = api.tracks[1].fx
      assert(fx[1].params[3] == 0.5, "ReaEQ (index 0) got the param")
      assert(fx[2].params[3] == nil, "Ozone 10 untouched")
    `);
  });

  it('lua plan: dryRun reports an unresolvable fx name as a conflict', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Kick", fx = { "ReaEQ", "ReaEQ (2)" } } } }
      local res = plan.run_plan(api, { dryRun = true, ops = {
        { op = "set_fx_params", track = "Kick", fx = "Nope", params = { { index = 0, value = 1 } } },
        { op = "set_fx_params", track = "Kick", fx = "ReaEQ", params = { { index = 0, value = 1 } } },
        { op = "add_fx", track = "Kick", fxName = "ReaComp" },
        { op = "set_fx_params", track = "Kick", fx = "ReaComp", params = { { index = 0, value = 1 } } },
      } }, {})
      assert(res.valid == false and #res.conflicts == 2, "conflicts: " .. #res.conflicts)
      assert(res.conflicts[1].op == 0 and res.conflicts[1].error:find("not found"))
      assert(res.conflicts[2].op == 1 and res.conflicts[2].error:find("more than one"))
      assert(api.writes == 0)
    `);
  });

  it('lua plan: dryRun counts FX added earlier in the plan', async () => {
    await runLua(`
      -- index refs (number and digit string) to an FX the plan adds are valid
      local api = new_fake{ tracks = { { name = "Bus" } } }
      local ok = plan.run_plan(api, { dryRun = true, ops = {
        { op = "add_fx", track = "Bus", fxName = "ReaComp" },
        { op = "set_fx_params", track = "Bus", fx = 0, params = { { index = 0, value = 1 } } },
        { op = "set_fx_params", track = "Bus", fx = "0", params = { { index = 0, value = 1 } } },
        { op = "set_fx_params", track = "Bus", fx = 1, params = { { index = 0, value = 1 } } },
      } }, {})
      assert(#ok.conflicts == 1 and ok.conflicts[1].op == 3, "only fx 1 is out of range: " .. #ok.conflicts)

      -- a second ReaComp added by the plan makes the name ambiguous
      local api2 = new_fake{ tracks = { { name = "Bus", fx = { "ReaComp" } } } }
      local amb = plan.run_plan(api2, { dryRun = true, ops = {
        { op = "add_fx", track = "Bus", fxName = "ReaComp" },
        { op = "set_fx_params", track = "Bus", fx = "ReaComp", params = { { index = 0, value = 1 } } },
      } }, {})
      assert(amb.valid == false and amb.conflicts[1].error:find("more than one"), "ambiguity reported")
    `);
  });

  it('lua plan: malformed JSON plan is rejected without writes', async () => {
    await runLua(`
      for _, bad in ipairs({ '[{"op":"set_track"', '[{"op":"set_track",}]', '[1] x', '{"op":tru}' }) do
        local api = new_fake{ tracks = { { name = "Kick" } } }
        local res, err = plan.run_plan(api, { ops = bad }, {})
        assert(res == nil and err:find("not a valid JSON array"), bad .. " -> " .. tostring(err))
        assert(api.writes == 0 and api.begins == 0, "no writes for " .. bad)
      end
    `);
  });

  it('mcp_bridge.lua and mcp_plan_lib.lua compile as Lua 5.4', async () => {
    const bridge = readFileSync(join(__dirname, '../../../reaper/mcp_bridge.lua'), 'utf8');
    const lua = await factory.createEngine();
    try {
      lua.global.set('BRIDGE_SRC', bridge);
      lua.global.set('LIB_SRC', LIB_SRC);
      await lua.doString(`
        local f, err = load(BRIDGE_SRC, "mcp_bridge.lua")
        assert(f, err)
        local g, err2 = load(LIB_SRC, "mcp_plan_lib.lua")
        assert(g, err2)
      `);
    } finally {
      lua.global.close();
    }
  });

  it('lua plan: rejects forward references and misplaced as', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Kick" } } }
      local _, err = plan.run_plan(api, { ops = {
        { op = "add_send", from = "Kick", to = "$bus" },
        { op = "add_track", name = "Bus", as = "$bus" },
        { op = "set_track", track = "Kick", volume = 0, as = "$x" },
      } }, {})
      assert(err:find("op 0") and err:find("not defined by an earlier op"), err)
      assert(err:find("op 2") and err:find("only allowed on add_track and add_fx"), err)
      assert(api.writes == 0)
    `);
  });

  it('lua plan: denied run_action rejects the plan', async () => {
    await runLua(`
      local acts = { [0] = {
        { id = 40001, name = "Track: Insert new track" },
        { id = 40004, name = "File: Quit REAPER" },
        { id = 40022, name = "File: Save project as..." },
      } }
      for _, bad in ipairs({
        { op = "run_action", action = 40004 },
        { op = "run_action", action = 40022 },
        { op = "run_action", action = "No such thing" },
        { op = "run_action", action = 40001, section = "midi_editor" },
      }) do
        local api = new_fake{ tracks = { { name = "Kick" } }, actions = acts }
        local res, err = plan.run_plan(api, { ops = {
          { op = "set_track", track = "Kick", volume = -6 },
          bad,
        } }, { actions = actions })
        assert(res == nil and err:find("Plan rejected") and err:find("op 1 %(run_action%)"), tostring(err))
        assert(api.writes == 0 and #api.ran == 0 and api.begins == 0, "nothing written or run")
      end
      local api = new_fake{ actions = acts }
      local dry = plan.run_plan(api, { dryRun = true, ops = { { op = "run_action", action = "track: insert NEW track" } } }, { actions = actions })
      assert(dry.valid and dry.ops[1].action.id == 40001, "dryRun shows the resolved action")
      local _, noctx = plan.run_plan(api, { ops = { { op = "run_action", action = 40001 } } }, {})
      assert(noctx:find("not loaded"), noctx)
    `);
  });

  it('lua plan: select_tracks by ref then run_action', async () => {
    await runLua(`
      local acts = { [0] = { { id = 40005, name = "Track: Remove tracks", on_run = function(api)
        for i = #api.tracks, 1, -1 do
          if api.tracks[i].selected then table.remove(api.tracks, i) end
        end
      end } } }
      local api = new_fake{ tracks = { { name = "Keep", selected = true }, { name = "Old" } }, actions = acts }
      local res, err = plan.run_plan(api, { ops = {
        { op = "add_track", name = "Temp", as = "$t" },
        { op = "select_tracks", tracks = { "$t", "Old" } },
        { op = "run_action", action = "Track: Remove tracks" },
      } }, { actions = actions })
      assert(err == nil, err)
      assert(res.applied == 3 and api.begins == 1 and api.ends == 1, "one undo block")
      assert(#res.results[2].result.selected == 2, "selection replaced: Temp + Old")
      assert(#api.tracks == 1 and api.tracks[1].name == "Keep", "action removed exactly the selected tracks")

      local api2 = new_fake{ tracks = { { name = "A", selected = true }, { name = "B" } }, actions = acts }
      local r2 = plan.run_plan(api2, { ops = { { op = "select_tracks", tracks = { "B" }, mode = "add" } } }, { actions = actions })
      assert(#r2.results[1].result.selected == 2, "add keeps A")
      local _, e = plan.run_plan(api2, { ops = { { op = "select_tracks", tracks = { "$nope" } } } }, { actions = actions })
      assert(e:find("not defined"), e)
    `);
  });
});
