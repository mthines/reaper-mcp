/**
 * Unit tests for reaper/mcp_arrange_lib.lua, run in real Lua 5.4 (wasmoon)
 * against a fake timeline (__fixtures__/fake_timeline.lua).
 * Assertions live in the Lua snippets: a failed `assert` rejects the promise.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_arrange_lib.lua'), 'utf8');
const PLAN_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_plan_lib.lua'), 'utf8');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_timeline.lua'), 'utf8');

const factory = new LuaFactory();

async function runLua(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    lua.global.set('PLAN_SRC', PLAN_SRC);
    await lua.doString(FAKE_SRC);
    await lua.doString(`
      arrange = load(LIB_SRC, "mcp_arrange_lib.lua")()
      plan = load(PLAN_SRC, "mcp_plan_lib.lua")()
      function near(a, b) return math.abs(a - b) < 1e-6 end
      ${snippet}`);
  } finally {
    lua.global.close();
  }
}

// Two tracks: a guitar with two items and a volume envelope with one automation item,
// a bass with one long item; a marker, a region, and two tempo markers.
const SONG = `
  local api = new_timeline{
    tracks = {
      { name = "Gtr", items = { { pos = 0, len = 4, name = "A", level = -12 }, { pos = 8, len = 4, name = "B", level = -6 } },
        envs = { { name = "Volume", pts = { { 0, 1 }, { 6, 0.5 }, { 12, 1 } }, ais = { { pos = 9, len = 2 } } } } },
      { name = "Bass", items = { { pos = 2, len = 10, name = "L", level = -18 } } },
    },
    markers = { { pos = 4, name = "Verse" }, { pos = 8, rend = 12, name = "Chorus", rgn = true } },
    tempo = { { t = 0, bpm = 120 }, { t = 10, bpm = 90 } },
  }
`;

describe('mcp_arrange_lib.lua (wasmoon)', () => {
  it('copy items: repeats items after themselves with fresh GUIDs, one undo point', async () => {
    await runLua(`${SONG}
      local src = api.tracks[1].items[1]
      local r = assert(arrange.copy_items(api, { items = { { trackIndex = 0, itemIndex = 0 } }, times = 2 }))
      assert(r.count == 2 and r.times == 2 and r.span == 4, r.count .. " " .. r.span)
      assert(api.names(0) == "A@0,A@4,A@8,B@8", api.names(0))
      assert(r.copies[1].position == 4 and r.copies[2].position == 8, "copies follow the source")
      local copy = api.tracks[1].items[2]
      assert(copy.guid ~= src.guid and copy.take.guid ~= src.take.guid, "fresh item and take GUIDs")
      assert(#api.undo_labels == 1 and api.undo_labels[1] == "MCP: Copy items", tostring(api.undo_labels[1]))
    `);
  });

  it('copy items: onto another track at a position, keeping the items\' spacing', async () => {
    await runLua(`${SONG}
      local r = assert(arrange.copy_items(api, { items = { { trackIndex = 0, itemIndex = 0 }, { trackIndex = 0, itemIndex = 1 } }, trackIndex = 1, position = 20 }))
      assert(r.count == 2)
      assert(api.names(1) == "L@2,A@20,B@28", api.names(1))
      assert(r.copies[1].trackIndex == 1, "reported on the destination track")
    `);
  });

  it('copy items: MIDI copies get their own pool unless pooled', async () => {
    await runLua(`
      local api = new_timeline{ tracks = { { items = { { pos = 0, len = 2, midi = true } } } } }
      local pool = api.tracks[1].items[1].take.pool
      assert(arrange.copy_items(api, { items = { { trackIndex = 0, itemIndex = 0 } } }))
      assert(api.tracks[1].items[2].take.pool ~= pool, "unpooled copy")
      assert(arrange.copy_items(api, { items = { { trackIndex = 0, itemIndex = 0 } }, pooled = true, position = 10 }))
      assert(api.tracks[1].items[3].take.pool == pool, "pooled copy shares the pool")
    `);
  });

  it('copy items: refuses a bad request and changes nothing', async () => {
    await runLua(`${SONG}
      local cases = {
        { items = {} },
        { items = { { trackIndex = 0, itemIndex = 9 } } },
        { items = { { trackIndex = 5, itemIndex = 0 } } },
        { items = { { trackIndex = 0, itemIndex = 0 }, { trackIndex = 0, itemIndex = 0 } } },
        { items = { { trackIndex = 0, itemIndex = 0 } }, times = 0 },
        { items = { { trackIndex = 0, itemIndex = 0 } }, times = 65 },
        { items = { { trackIndex = 0, itemIndex = 0 } }, position = -1 },
        { items = { { trackIndex = 0, itemIndex = 0 } }, trackIndex = 7 },
      }
      for k, p in ipairs(cases) do
        local ok, err = arrange.copy_items(api, p)
        assert(not ok and err:find("nothing changed"), "case " .. k .. ": " .. tostring(err))
      end
      assert(api.writes == 0 and #api.undo_labels == 0, "no writes, no undo point")
    `);
  });

  it('insert time: shifts items, markers, regions, tempo, envelope points and automation items; splits what spans it', async () => {
    await runLua(`${SONG}
      local r = assert(arrange.insert_time(api, { position = 6, length = 2 }))
      -- Gtr: A (0-4) stays, B (8) moves to 10; Bass L (2-12) is split at 6, its right part at 8
      assert(api.names(0) == "A@0,B@10", api.names(0))
      assert(api.names(1) == "L@2,L@8", api.names(1))
      assert(near(api.tracks[2].items[1].vals.D_LENGTH, 4) and near(api.tracks[2].items[2].vals.D_LENGTH, 6), "split lengths")
      assert(near(api.tracks[2].items[2].take.vals.D_STARTOFFS, 4), "right part plays on from the split")
      assert(r.itemsMoved == 1 and r.itemsSplit == 1, r.itemsMoved .. " " .. r.itemsSplit)
      -- Verse marker at 4 stays; Chorus region 8-12 moves to 10-14
      assert(api.markers[1].pos == 4 and api.markers[2].pos == 10 and api.markers[2].rend == 14)
      assert(r.markersMoved == 1)
      -- Tempo at 10 moves to 12
      assert(api.tempo[2].t == 12 and r.tempoMarkersMoved == 1)
      -- Envelope points at 6 and 12 move to 8 and 14; the automation item at 9 to 11
      local env = api.tracks[1].envs[1]
      assert(env.pts[2].t == 8 and env.pts[3].t == 14, env.pts[2].t .. " " .. env.pts[3].t)
      assert(env.ais[1].D_POSITION == 11 and r.automationItemsMoved == 1)
      assert(r.envelopePointsMoved == 2)
      assert(#api.undo_labels == 1 and api.undo_labels[1] == "MCP: Insert time")
    `);
  });

  it('insert time: extends a region that spans the position; splitItems false leaves spanning items whole', async () => {
    await runLua(`${SONG}
      local r = assert(arrange.insert_time(api, { position = 10, length = 4, splitItems = false }))
      assert(api.markers[2].pos == 8 and api.markers[2].rend == 16 and r.regionsExtended == 1)
      assert(api.names(1) == "L@2" and r.itemsSplit == 0, api.names(1))
      assert(api.names(0) == "A@0,B@8", "B starts before 10 and is not split")
    `);
  });

  it('insert time and copy section: leave the master\'s Tempo map envelope to the tempo markers (no double move)', async () => {
    await runLua(`
      local api = new_timeline{
        tracks = { { envs = { { pts = { { 1, 1 }, { 3, 0 } } } } } },
        master_envs = { { name = "Tempo map", pts = { { 0, 120 }, { 6, 90 } } }, { name = "Volume", pts = { { 6, 1 } } } },
        tempo = { { t = 0, bpm = 120 }, { t = 6, bpm = 90 } },
      }
      assert(arrange.insert_time(api, { position = 2, length = 3 }))
      local tmap, vol = api.master.envs[1], api.master.envs[2]
      assert(tmap.pts[2].t == 6, "tempo map envelope untouched by the envelope pass: " .. tmap.pts[2].t)
      assert(api.tempo[2].t == 9 and vol.pts[1].t == 9, "tempo marker and the master volume point moved once")
      local r = assert(arrange.copy_section(api, { start = 0, ["end"] = 4, position = 20 }))
      assert(#tmap.pts == 2, "no tempo points copied")
    `);
  });

  it('insert time: refuses a bad request and changes nothing', async () => {
    await runLua(`${SONG}
      for k, p in ipairs({ { position = -1, length = 2 }, { position = 2, length = 0 }, { position = 2, length = 4000 }, { position = 2, length = 1, splitItems = "yes" } }) do
        local ok, err = arrange.insert_time(api, p)
        assert(not ok and err:find("nothing changed"), "case " .. k .. ": " .. tostring(err))
      end
      assert(api.writes == 0 and #api.undo_labels == 0)
    `);
  });

  it('remove time: deletes what lies inside, trims what crosses, and pulls the rest back', async () => {
    await runLua(`${SONG}
      local r = assert(arrange.remove_time(api, { start = 3, ["end"] = 9 }))
      -- Gtr: A (0-4) trimmed to 0-3; B (8-12) loses 8-9 and starts at 3
      assert(api.names(0) == "A@0,B@3", api.names(0))
      assert(near(api.tracks[1].items[1].vals.D_LENGTH, 3) and near(api.tracks[1].items[2].vals.D_LENGTH, 3), "trimmed lengths")
      assert(near(api.tracks[1].items[2].take.vals.D_STARTOFFS, 1), "B plays on from where the cut ended")
      -- Bass L (2-12) keeps 2-3 and 9-12, joined at 3
      assert(api.names(1) == "L@2,L@3", api.names(1))
      assert(r.itemsTrimmed == 3, "A, B and L cross the cut: " .. r.itemsTrimmed)
      -- Verse marker (4) deleted; Chorus region 8-12 becomes 3-6
      assert(#api.markers == 1 and api.markers[1].rgn and api.markers[1].pos == 3 and api.markers[1].rend == 6)
      assert(r.markersDeleted == 1 and r.regionsTrimmed == 1)
      -- Tempo at 10 moves to 4; the start marker stays
      assert(#api.tempo == 2 and api.tempo[2].t == 4 and api.tempo[2].bpm == 90)
      -- Point at 6 deleted, 12 → 6; automation item 9-11 → 3-5
      local env = api.tracks[1].envs[1]
      assert(#env.pts == 2 and env.pts[2].t == 6 and r.envelopePointsDeleted == 1)
      assert(env.ais[1].D_POSITION == 3 and r.automationItemsMoved == 1)
      assert(#api.undo_labels == 1 and api.undo_labels[1] == "MCP: Remove time")
    `);
  });

  it('remove time: keeps the tempo in force after the cut by moving the last marker inside it to the cut', async () => {
    await runLua(`
      local api = new_timeline{ tempo = { { t = 0, bpm = 120 }, { t = 4, bpm = 100 }, { t = 6, bpm = 80 }, { t = 12, bpm = 140 } } }
      local r = assert(arrange.remove_time(api, { start = 3, ["end"] = 8 }))
      assert(#api.tempo == 3, "one inside marker deleted: " .. #api.tempo)
      assert(api.tempo[2].t == 3 and api.tempo[2].bpm == 80, "80 bpm (in force at the end) now starts at the cut")
      assert(api.tempo[3].t == 7 and api.tempo[3].bpm == 140, "later marker pulled back")
      assert(r.tempoMarkersDeleted == 1)
    `);
  });

  it('remove time: deletes automation items inside the cut and keeps the user\'s other selected items', async () => {
    await runLua(`
      local api = new_timeline{ tracks = { { envs = { { ais = { { pos = 1, len = 1, sel = true }, { pos = 4, len = 1 }, { pos = 10, len = 1, sel = true } } } } } } }
      local r = assert(arrange.remove_time(api, { start = 3, ["end"] = 6 }))
      local ais = api.tracks[1].envs[1].ais
      assert(#ais == 2 and r.automationItemsDeleted == 1)
      assert(ais[1].D_POSITION == 1 and ais[1].D_UISEL == 1, "first item kept, still selected")
      assert(ais[2].D_POSITION == 7 and ais[2].D_UISEL == 1, "last item moved back, still selected")
    `);
  });

  it('remove time: refuses a bad range and changes nothing', async () => {
    await runLua(`${SONG}
      for k, p in ipairs({ { start = -1, ["end"] = 2 }, { start = 4, ["end"] = 4 }, { start = 4, ["end"] = 2 }, { start = 0, ["end"] = 4000 } }) do
        local ok, err = arrange.remove_time(api, p)
        assert(not ok and err:find("nothing changed"), "case " .. k .. ": " .. tostring(err))
      end
      assert(api.writes == 0 and #api.undo_labels == 0)
    `);
  });

  it('copy section: copies a region\'s items and automation to a later position, trimmed to the region', async () => {
    await runLua(`${SONG}
      local r = assert(arrange.copy_section(api, { regionIndex = 1, position = 20 }))
      assert(r.region == "Chorus" and r.itemCount == 2, tostring(r.itemCount))
      -- Gtr B (8-12) → 20-24; Bass L (2-12) trimmed to 8-12 → 20-24
      assert(api.names(0) == "A@0,B@8,B@20", api.names(0))
      assert(api.names(1) == "L@2,L@20", api.names(1))
      local lc = api.tracks[2].items[2]
      assert(near(lc.vals.D_LENGTH, 4) and near(lc.take.vals.D_STARTOFFS, 6), "the copy plays the region's part")
      -- No volume point lies inside 8-12, so the envelope is left as it was
      local at = {}
      for _, p in ipairs(api.tracks[1].envs[1].pts) do at[#at + 1] = p.t end
      assert(r.envelopePoints == 0 and table.concat(at, ",") == "0,6,12", table.concat(at, ","))
      assert(#api.undo_labels == 1 and api.undo_labels[1] == "MCP: Copy section")
    `);
  });

  it('copy section: picks the region by the number list_regions returns, not by its place in the list', async () => {
    await runLua(`
      local api = new_timeline{
        tracks = { { items = { { pos = 0, len = 2, name = "I" }, { pos = 4, len = 2, name = "C" } } } },
        markers = { { pos = 0, rend = 2, name = "Intro", rgn = true, num = 7 }, { pos = 4, rend = 6, name = "Chorus", rgn = true, num = 2 } },
      }
      local r = assert(arrange.copy_section(api, { regionIndex = 2, position = 10 }))
      assert(r.region == "Chorus" and api.names(0) == "I@0,C@4,C@10", api.names(0))
      local ok, err = arrange.copy_section(api, { regionIndex = 0, position = 20 })
      assert(not ok and err:find("no region 0"), tostring(err))
    `);
  });

  it('copy section: with insert, opens time first so nothing after the position is overwritten', async () => {
    await runLua(`${SONG}
      local r = assert(arrange.copy_section(api, { start = 0, ["end"] = 4, position = 0, insert = true, tracks = { 0 } }))
      assert(r.inserted and r.inserted.length == 4)
      -- Everything moved 4 s later; the copy of A fills 0-4
      assert(api.names(0) == "A@0,A@4,B@12", api.names(0))
      assert(api.markers[1].pos == 8 and api.tempo[2].t == 14)
    `);
  });

  it('copy section: copies envelope points with values at the section edges', async () => {
    await runLua(`
      local api = new_timeline{ tracks = { { envs = { { pts = { { 0, 0 }, { 2, 1 }, { 4, 0 } } } } } } }
      local r = assert(arrange.copy_section(api, { start = 1, ["end"] = 3, position = 10 }))
      local env = api.tracks[1].envs[1]
      local got = {}
      for _, p in ipairs(env.pts) do got[#got + 1] = p.t .. "=" .. p.v end
      assert(table.concat(got, " ") == "0=0 2=1 4=0 9.999=0 10=0.5 11=1 12=0.5 12.001=0", table.concat(got, " "))
      assert(r.envelopePoints == 1)
    `);
  });

  it('copy section: keeps the shape of the destination\'s automation leading into and out of the copy', async () => {
    await runLua(`
      local api = new_timeline{ tracks = { { envs = { { pts = { { 0, 0 }, { 15, 0.15 }, { 100, 1 } } } } } } }
      local function at(t) local _, v = api.Envelope_Evaluate(api.tracks[1].envs[1], t) return v end
      local v49, v61 = at(49), at(61)
      assert(arrange.copy_section(api, { start = 10, ["end"] = 20, position = 50 }))
      assert(near(at(49), v49) and near(at(61), v61), at(49) .. " " .. at(61))
    `);
  });

  it('copy section: refuses an overlap, an unknown region and a bad track, changing nothing', async () => {
    await runLua(`${SONG}
      local cases = {
        { regionIndex = 1, position = 10 },
        { regionIndex = 1, position = 5 },
        { regionIndex = 3, position = 20 },
        { start = 4, ["end"] = 2, position = 20 },
        { regionIndex = 1, position = 10, insert = true },
        { regionIndex = 1, position = 20, tracks = { 9 } },
      }
      for k, p in ipairs(cases) do
        local ok, err = arrange.copy_section(api, p)
        assert(not ok and err:find("nothing changed"), "case " .. k .. ": " .. tostring(err))
      end
      assert(api.writes == 0 and #api.undo_labels == 0)
    `);
  });

  it('process items: normalize sets item gain to the target and reports the gain before and after', async () => {
    await runLua(`${SONG}
      local r = assert(arrange.process_items(api, { operation = "normalize", items = { { trackIndex = 0, itemIndex = 0 }, { trackIndex = 0, itemIndex = 1 } }, target = -1 }))
      assert(r.mode == "peak" and r.target == -1)
      local a, b = api.tracks[1].items[1], api.tracks[1].items[2]
      assert(math.abs(20 * math.log(a.vals.D_VOL, 10) - 11) < 1e-6, "-12 dB → -1 dB is +11 dB")
      assert(math.abs(20 * math.log(b.vals.D_VOL, 10) - 5) < 1e-6, "-6 dB → -1 dB is +5 dB")
      assert(r.items[1].levelBefore == -12 and r.items[1].gainBeforeDb == 0 and r.items[1].gainAfterDb == 11)
      assert(#api.undo_labels == 1 and api.undo_labels[1] == "MCP: Normalize items")
    `);
  });

  it('process items: normalize counts a polarity-flipped take at its real level', async () => {
    await runLua(`
      local api = new_timeline{ tracks = { { items = { { pos = 0, len = 4, name = "F", level = -12, take_vol = -0.5 } } } } }
      local r = assert(arrange.process_items(api, { operation = "normalize", items = { { trackIndex = 0, itemIndex = 0 } }, target = -1 }))
      local flip = 20 * math.log(0.5, 10)
      assert(math.abs(r.items[1].levelBefore - (-12 + flip)) < 0.001, tostring(r.items[1].levelBefore))
      -- Item gain times the take's magnitude lands the item on the target
      local out = 20 * math.log(api.tracks[1].items[1].vals.D_VOL * 0.5, 10) - 12
      assert(math.abs(out - (-1)) < 1e-6, tostring(out))
    `);
  });

  it('process items: normalize to LUFS needs a target; MIDI and silent items are refused, changing nothing', async () => {
    await runLua(`
      local api = new_timeline{ tracks = { { items = { { pos = 0, len = 1 }, { pos = 2, len = 1, midi = true }, { pos = 4, len = 1, level = -200 } } } } }
      local cases = {
        { operation = "normalize", items = { { trackIndex = 0, itemIndex = 0 } }, mode = "lufs_i" },
        { operation = "normalize", items = { { trackIndex = 0, itemIndex = 0 } }, target = 3 },
        { operation = "normalize", items = { { trackIndex = 0, itemIndex = 0 } }, mode = "loud" },
        { operation = "normalize", items = { { trackIndex = 0, itemIndex = 1 } } },
        { operation = "normalize", items = { { trackIndex = 0, itemIndex = 2 } } },
        { operation = "reverse", items = { { trackIndex = 0, itemIndex = 1 } } },
        { operation = "stretch", items = { { trackIndex = 0, itemIndex = 0 } } },
      }
      for k, p in ipairs(cases) do
        local ok, err = arrange.process_items(api, p)
        assert(not ok and err:find("nothing changed"), "case " .. k .. ": " .. tostring(err))
      end
      assert(api.writes == 0 and #api.undo_labels == 0)
      assert(arrange.process_items(api, { operation = "normalize", mode = "lufs_i", target = -14, items = { { trackIndex = 0, itemIndex = 0 } } }))
    `);
  });

  it('process items: reverse and glue act on the named items only and put the selection back', async () => {
    await runLua(`${SONG}
      local bass = api.tracks[2].items[1]
      bass.selected = true
      local r = assert(arrange.process_items(api, { operation = "reverse", items = { { trackIndex = 0, itemIndex = 1 } } }))
      assert(api.tracks[1].items[2].take.reversed and not api.tracks[1].items[1].take.reversed and not bass.take.reversed)
      assert(r.items[1].position == 8)
      assert(bass.selected and not api.tracks[1].items[2].selected, "selection restored")

      local g = assert(arrange.process_items(api, { operation = "glue", items = { { trackIndex = 0, itemIndex = 0 }, { trackIndex = 0, itemIndex = 1 } } }))
      assert(#api.tracks[1].items == 1 and #g.items == 1 and g.items[1].position == 0 and g.items[1].length == 12, #g.items)
      assert(bass.selected and not api.tracks[1].items[1].selected, "glued item not left selected")
      assert(api.undo_labels[2] == "MCP: Glue items")
    `);
  });

  it('plan ops: check_op refuses without writing, apply_op runs and raises on a refusal', async () => {
    await runLua(`${SONG}
      assert(arrange.PLAN_OPS.copy_items and arrange.PLAN_OPS.insert_time and arrange.PLAN_OPS.remove_time)
      assert(arrange.check_op(api, { op = "insert_time", position = 2, length = 0 }):find("length"))
      assert(arrange.check_op(api, { op = "copy_items", items = { { trackIndex = 0, itemIndex = 0 } } }) == nil)
      assert(api.writes == 0)
      local r = arrange.apply_op(api, { op = "insert_time", position = 0, length = 1 })
      assert(r.itemsMoved == 3 and #api.undo_labels == 0, "no undo block of its own (the plan owns it)")
      local ok, err = pcall(arrange.apply_op, api, { op = "remove_time", start = 5, ["end"] = 1 })
      assert(not ok and tostring(err):find("remove_time:"), tostring(err))
    `);
  });
  it('plan ops: run_plan copies, inserts and removes time in one undo point', async () => {
    await runLua(`${SONG}
      local ops = '[{"op":"copy_items","items":[{"trackIndex":0,"itemIndex":0}],"position":20},'
        .. '{"op":"insert_time","position":0,"length":2},{"op":"remove_time","start":30,"end":31}]'
      local r = assert(plan.run_plan(api, { ops = ops, label = "MCP: arrange" }, { arrange = arrange }))
      assert(r.applied == 3, r.applied)
      assert(api.names(0) == "A@2,B@10,A@22", api.names(0))
      assert(#api.undo_labels == 1 and api.undo_labels[1] == "MCP: arrange", "one undo point")
    `);
  });

  it('plan ops: run_plan refuses item refs after an op that moves items, and a bad op, changing nothing', async () => {
    await runLua(`${SONG}
      local _, err = plan.run_plan(api, { ops = '[{"op":"insert_time","position":0,"length":2},{"op":"copy_items","items":[{"trackIndex":0,"itemIndex":0}]}]' }, { arrange = arrange })
      assert(err and err:find("nothing was changed") and err:find("changes them first"), tostring(err))
      local _, e2 = plan.run_plan(api, { ops = '[{"op":"remove_time","start":4,"end":2}]' }, { arrange = arrange })
      assert(e2 and e2:find("end must be after start"), tostring(e2))
      local _, e3 = plan.run_plan(api, { ops = '[{"op":"insert_time","position":0,"length":2}]' }, {})
      assert(e3 and e3:find("not loaded"), tostring(e3))
      assert(api.writes == 0 and #api.undo_labels == 0)
    `);
  });
});
