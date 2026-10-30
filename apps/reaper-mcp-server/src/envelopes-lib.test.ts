/**
 * Unit tests for reaper/mcp_envelopes_lib.lua, run in real Lua 5.4 (wasmoon)
 * against a small fake ReaScript API: tracks with envelopes, fader-scaled
 * volume values, automation items whose pools share points, track and
 * automation item selection, and the actions the lib runs. Assertions live
 * in the Lua snippets: a failed `assert` rejects the promise.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_envelopes_lib.lua'), 'utf8');

const FAKE = `
FLAG = 0x10000000
-- Fader scaling stand-in: invertible, and 0 dB is 716.21785 like REAPER's
local ZERO = 716.21785031261
local function to_mode(mode, amp) if mode == 1 then return ZERO * amp ^ 0.25 end return amp end
local function from_mode(mode, v) if mode == 1 then return (v / ZERO) ^ 4 end return v end

function new_fake(spec)
  local api = { writes = 0, undo = {}, actions = {}, pools = {} }
  local function write() api.writes = api.writes + 1 end
  local function track(name, envs, chunk)
    local tr = { name = name, envs = {}, selected = false, chunk = chunk or "<TRACK\\nNAME x\\n>" }
    for _, e in ipairs(envs or {}) do
      tr.envs[#tr.envs + 1] = { name = e.name, mode = e.mode or 0, points = e.points or {}, ais = e.ais or {},
        chunk = "<ENV\\nACT " .. (e.act or 1) .. " -1\\nVIS " .. (e.vis or 1) .. " 1 1\\n>", track = tr }
    end
    return tr
  end
  api.tracks = {}
  for _, t in ipairs(spec.tracks or {}) do api.tracks[#api.tracks + 1] = track(t.name, t.envs, t.chunk) end
  api.master = track("MASTER", spec.masterEnvs)
  for id, pts in pairs(spec.pools or {}) do api.pools[id] = pts end
  -- How the actions create envelopes: name -> created env spec (nil = the action does nothing)
  api.action_creates = spec.action_creates or { [40406] = "Volume", [40407] = "Pan", [40867] = "Mute", [42020] = "Trim Volume" }

  function api.GetTrack(_, i) return api.tracks[i + 1] end
  function api.GetMasterTrack() return api.master end
  function api.CountTracks() return #api.tracks end
  function api.CountTrackEnvelopes(tr) return #tr.envs end
  function api.GetTrackEnvelope(tr, i) return tr.envs[i + 1] end
  function api.GetTrackEnvelopeByName(tr, name)
    for _, e in ipairs(tr.envs) do if e.name == name then return e end end
  end
  function api.GetEnvelopeName(env) return true, env.name end
  function api.GetEnvelopeScalingMode(env) return env.mode end
  function api.ScaleToEnvelopeMode(mode, v) return to_mode(mode, v) end
  function api.ScaleFromEnvelopeMode(mode, v) return from_mode(mode, v) end
  function api.Undo_BeginBlock() end
  function api.Undo_EndBlock(label) api.undo[#api.undo + 1] = label end
  function api.UpdateArrange() end
  function api.TrackList_AdjustWindows() end

  -- Points: -1 = the envelope's own; an automation item's are its pool's, stored
  -- relative to the item start so every instance of the pool shows the same shape
  local function list(env, ai, plain)
    if ai < 0 then return env.points, 0 end
    if not plain then assert(ai & FLAG ~= 0, "automation item point calls must count one loop iteration (0x10000000)") end
    local item = env.ais[(ai & ~FLAG) + 1]
    api.pools[item.pool] = api.pools[item.pool] or {}
    return api.pools[item.pool], item.pos
  end
  function api.CountEnvelopePointsEx(env, ai) return #(list(env, ai)) end
  function api.CountEnvelopePoints(env) return #env.points end
  function api.GetEnvelopePointEx(env, ai, i)
    local pts, base = list(env, ai)
    local p = pts[i + 1]
    if not p then return false, 0, 0, 0, 0, false end
    return true, p.time + base, p.value, p.shape or 0, p.tension or 0, p.selected or false
  end
  -- 90 BPM: 1.5 quarter notes a second
  function api.TimeMap2_timeToQN(_, t) return t * 1.5 end
  function api.TimeMap2_QNToTime(_, qn) return qn / 1.5 end
  api.pool_qn = {}
  function api.InsertEnvelopePointEx(env, ai, time, value, shape, tension, sel)
    write()
    local pts, base = list(env, ai)
    if ai >= 0 then
      -- Like REAPER: a point outside the pool's own length is dropped without an error
      local qn = api.pool_qn[env.ais[(ai & ~FLAG) + 1].pool]
      if time < base or qn and (time - base) * 1.5 >= qn then return true end
    end
    pts[#pts + 1] = { time = time - base, value = value, shape = shape, tension = tension, selected = sel }
    return true
  end
  function api.SetEnvelopePointEx(env, ai, i, time, value, shape, tension, sel)
    -- Like REAPER 7.40: a flagged automation item index changes nothing
    if ai >= 0 and ai & FLAG ~= 0 then return false end
    write()
    local pts, base = list(env, ai, true)
    pts[i + 1] = { time = time - base, value = value, shape = shape, tension = tension, selected = sel }
    return true
  end
  function api.DeleteEnvelopePointEx(env, ai, i)
    write()
    local pts = list(env, ai)
    table.remove(pts, i + 1)
    return true
  end
  function api.DeleteEnvelopePointRangeEx(env, ai, t0, t1)
    write()
    local pts, base = list(env, ai)
    for i = #pts, 1, -1 do
      local t = pts[i].time + base
      if t >= t0 and t < t1 then table.remove(pts, i) end
    end
    return true
  end
  function api.Envelope_SortPointsEx(env, ai)
    assert(ai == -1 or ai >= 0 and ai & FLAG == 0, "sort takes the plain automation item index")
    local pts = ai < 0 and env.points or api.pools[env.ais[ai + 1].pool]
    table.sort(pts, function(a, b) return a.time < b.time end)
  end

  -- Automation items
  function api.CountAutomationItems(env) return #env.ais end
  local AI_KEYS = { D_POOL_QNLEN = "qnlen", D_POOL_ID = "pool", D_POSITION = "pos", D_LENGTH = "len", D_STARTOFFS = "offs", D_PLAYRATE = "rate",
    D_BASELINE = "base", D_AMPLITUDE = "amp", D_LOOPSRC = "loop", D_UISEL = "sel" }
  local AI_DEFAULT = { offs = 0, rate = 1, base = 0.5, amp = 1, loop = 1, sel = 0 }
  function api.GetSetAutomationItemInfo(env, i, parm, value, set)
    local item = env.ais[i + 1]
    local key = AI_KEYS[parm]
    if key == "qnlen" then
      if set then write(); api.pool_qn[item.pool] = value end
      return api.pool_qn[item.pool] or 0
    end
    if set then
      if parm ~= "D_UISEL" then write() end
      item[key] = value
      return value
    end
    local v = item[key]
    if v == nil then v = AI_DEFAULT[key] end
    if type(v) == "boolean" then v = v and 1 or 0 end
    return v
  end
  function api.GetSetAutomationItemInfo_String(env, i, parm, value, set)
    local item = env.ais[i + 1]
    api.pool_names = api.pool_names or {}
    if set then write(); api.pool_names[item.pool] = value; return true, value end
    return true, api.pool_names[item.pool] or ""
  end
  function api.InsertAutomationItem(env, pool, pos, len)
    write()
    if pool < 0 then
      -- capture: a new pool holding the underlying points in range, moved out of the envelope
      local max = -1
      for _, t in ipairs(api.tracks) do for _, e in ipairs(t.envs) do for _, a in ipairs(e.ais) do max = math.max(max, a.pool) end end end
      pool = max + 1
      api.pools[pool] = {}
      api.pool_qn[pool] = math.floor(len * 1.5) - 1
      for i = #env.points, 1, -1 do
        local p = env.points[i]
        if p.time >= pos and p.time < pos + len then
          table.insert(api.pools[pool], 1, { time = p.time - pos, value = p.value, shape = p.shape })
          table.remove(env.points, i)
        end
      end
    end
    if not api.pools[pool] or api.pool_qn[pool] == nil then
      -- A new pool: REAPER can make it shorter than the item (49 QN for 50.25, seen live)
      api.pool_qn[pool] = api.pool_qn[pool] or math.floor(len * 1.5) - 1
    end
    env.ais[#env.ais + 1] = { pool = pool, pos = pos, len = len }
    table.sort(env.ais, function(a, b) return a.pos < b.pos end)
    for i, a in ipairs(env.ais) do if a.pos == pos and a.pool == pool then return i - 1 end end
  end

  -- Selection and actions
  function api.IsTrackSelected(tr) return tr.selected end
  function api.SetTrackSelected(tr, s) tr.selected = s end
  function api.SetOnlyTrackSelected(tr)
    for _, t in ipairs(api.tracks) do t.selected = false end
    api.master.selected = false
    tr.selected = true
  end
  function api.Main_OnCommand(id)
    write()
    api.actions[#api.actions + 1] = id
    local name = api.action_creates[id]
    if name then
      for _, t in ipairs(api.tracks) do
        if t.selected and not api.GetTrackEnvelopeByName(t, name) then
          t.envs[#t.envs + 1] = { name = name, mode = name:find("Volume") and 1 or 0, points = {}, ais = {},
            chunk = "<ENV\\nACT 1 -1\\nVIS 1 1 1\\n>", track = t }
        end
      end
    elseif id == 42086 then
      for _, t in ipairs(api.tracks) do for _, e in ipairs(t.envs) do
        for i = #e.ais, 1, -1 do if (e.ais[i].sel or 0) ~= 0 then table.remove(e.ais, i) end end
      end end
    end
  end
  function api.GetTrackStateChunk(tr) return true, tr.chunk end
  function api.SetTrackStateChunk(tr, chunk)
    write()
    tr.chunk = chunk
    if chunk:find("<WIDTHENV2\\n", 1, true) and not api.GetTrackEnvelopeByName(tr, "Width") then
      tr.envs[#tr.envs + 1] = { name = "Width", mode = 0, points = { { time = 0, value = 1 } }, ais = {}, chunk = "<ENV\\nACT 1 -1\\nVIS 1 1 1\\n>", track = tr }
    end
  end
  function api.GetEnvelopeStateChunk(env) return true, env.chunk end
  function api.SetEnvelopeStateChunk(env, chunk) write(); env.chunk = chunk end
  return api
end

function near(a, b, eps) return math.abs(a - b) < (eps or 1e-6) end
`;

const factory = new LuaFactory();

async function runLua(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    await lua.doString(FAKE);
    await lua.doString(`env = load(LIB_SRC, "mcp_envelopes_lib.lua")()\n${snippet}`);
  } finally {
    lua.global.close();
  }
}

const VOX = `{ name = "Vox", envs = { { name = "Volume", mode = 1, points = {
  { time = 0, value = 716.21785031261 }, { time = 10, value = 716.21785031261 }, { time = 20, value = 716.21785031261 } } },
  { name = "Pan", points = { { time = 0, value = 0 } } } } }`;

describe('mcp_envelopes_lib.lua (wasmoon)', () => {
  it('volume envelopes read and write dB through the envelope scaling; 0 dB is 716.2, not 1.0', async () => {
    await runLua(`
      local api = new_fake{ tracks = { ${VOX} } }
      local r = assert(env.get_points(api, { trackIndex = 0, envelopeIndex = 0 }))
      assert(r.unit == "dB" and r.points[1].db == 0, "0 dB read back, got " .. tostring(r.points[1].db))
      r = assert(env.insert_points(api, { trackIndex = 0, envelopeIndex = 0 }, { { time = 5, db = -1 } }))
      assert(r.insertedPoints == 1 and r.totalPoints == 4)
      local p = env.get_points(api, { trackIndex = 0, envelopeIndex = 0 }).points[2]
      assert(p.time == 5 and p.db == -1, "inserted at -1 dB, got " .. tostring(p.db))
      assert(p.value < 716.21785031261 and p.value > 600, "raw value on the fader scale: " .. p.value)
    `);
  });

  it('refuses db on a pan envelope and a point with both value and db, changing nothing', async () => {
    await runLua(`
      local api = new_fake{ tracks = { ${VOX} } }
      local r, err = env.insert_points(api, { trackIndex = 0, envelopeIndex = 1 }, { { time = 1, db = -3 } })
      assert(not r and err:find("volume envelopes"), tostring(err))
      r, err = env.insert_points(api, { trackIndex = 0, envelopeIndex = 0 }, { { time = 1, db = -3 }, { time = 2, value = 1, db = 0 } })
      assert(not r and err:find("not both"), tostring(err))
      assert(api.writes == 0, "nothing written")
    `);
  });

  it('edits points by index: new level in dB and time, other fields kept; a bad index changes nothing', async () => {
    await runLua(`
      local api = new_fake{ tracks = { ${VOX} } }
      local p = { trackIndex = 0, envelopeIndex = 0 }
      local r, err = env.edit_points(api, p, { { index = 1, db = -2 }, { index = 9, db = 0 } })
      assert(not r and err:find("out of range"), tostring(err))
      assert(api.writes == 0)
      r, err = env.edit_points(api, p, { { index = 1, db = 0 }, { index = 1, time = 3 } })
      assert(not r and err:find("twice"), tostring(err))
      r = assert(env.edit_points(api, p, { { index = 1, db = -2, shape = 2 }, { index = 2, time = 25 } }))
      assert(r.editedPoints == 2)
      local pts = env.get_points(api, p).points
      assert(pts[2].time == 10 and pts[2].db == -2 and pts[2].shape == 2, "point 1 at -2 dB, time kept")
      assert(pts[3].time == 25 and pts[3].db == 0, "point 2 moved, level kept")
    `);
  });

  it('deletes the point at an index, not the points between index and index+1 seconds', async () => {
    await runLua(`
      local api = new_fake{ tracks = { ${VOX} } }
      local p = { trackIndex = 0, envelopeIndex = 0, pointIndex = 1 }
      local r = assert(env.delete_point(api, p))
      assert(r.deleted.time == 10 and r.totalPoints == 2, "the 10 s point went")
      local pts = env.get_points(api, p).points
      assert(pts[1].time == 0 and pts[2].time == 20)
      local _, err = env.delete_point(api, { trackIndex = 0, envelopeIndex = 0, pointIndex = 5 })
      assert(err:find("out of range"))
    `);
  });

  it('removes a time range and clears everything', async () => {
    await runLua(`
      local api = new_fake{ tracks = { ${VOX} } }
      local r = assert(env.remove_range(api, { trackIndex = 0, envelopeIndex = 0, timeStart = 5, timeEnd = 20 }, "x"))
      assert(r.deletedPoints == 1 and r.totalPoints == 2, "only the 10 s point is in [5, 20)")
      local _, err = env.remove_range(api, { trackIndex = 0, envelopeIndex = 0, timeStart = 5, timeEnd = 5 }, "x")
      assert(err:find("after"))
      r = assert(env.remove_range(api, { trackIndex = 0, envelopeIndex = 0 }, "MCP: Clear envelope"))
      assert(r.deletedPoints == 2 and r.totalPoints == 0)
    `);
  });

  it('creates a Volume envelope with the native action and leaves the track selection as it was', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "A" }, { name = "Vox" }, { name = "C" } } }
      api.tracks[1].selected, api.tracks[3].selected = true, true
      local r = assert(env.create(api, { trackIndex = 1, envelopeName = "Volume" }))
      assert(r.created and r.envelopeIndex == 0 and r.name == "Volume", "created")
      assert(api.actions[1] == 40406)
      assert(api.tracks[1].selected and not api.tracks[2].selected and api.tracks[3].selected, "selection restored")
      r = assert(env.create(api, { trackIndex = 1, envelopeName = "Volume" }))
      assert(r.created == false and #api.actions == 1, "an existing envelope is only shown, the toggle is not run again")
    `);
  });

  it('shows a hidden existing envelope', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Vox", envs = { { name = "Pan", act = 0, vis = 0 } } } } }
      assert(env.create(api, { trackIndex = 0, envelopeName = "Pan" }))
      local c = api.tracks[1].envs[1].chunk
      assert(c:find("ACT 1") and c:find("VIS 1"), c)
    `);
  });

  it('adds Width (no native action) through the chunk, before the first item', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Vox", chunk = "<TRACK\\nNAME Vox\\n<ITEM\\nPOSITION 0\\n>\\n>" } } }
      local r = assert(env.create(api, { trackIndex = 0, envelopeName = "Width" }))
      assert(r.created and r.name == "Width")
      local c = api.tracks[1].chunk
      assert(c:find("<WIDTHENV2", 1, true) < c:find("<ITEM", 1, true), c)
      local _, err = env.create(api, { trackIndex = 0, envelopeName = "Tempo" })
      assert(err:find("Unknown envelope name"))
    `);
  });

  it('pooled automation items share their points: one edit changes every instance', async () => {
    await runLua(`
      local api = new_fake{ tracks = { ${VOX} } }
      local p = { trackIndex = 0, envelopeIndex = 0 }
      local a = assert(env.insert_item(api, { trackIndex = 0, envelopeIndex = 0, position = 30, length = 8, name = "Vox Chorus" },
        { { time = 0, db = -1 }, { time = 8, db = -1 } }))
      assert(a.automationItem.poolId == 0 and a.automationItem.name == "Vox Chorus" and a.pooledWith == 0)
      assert(a.automationItem.pointCount == 2)
      local b = assert(env.insert_item(api, { trackIndex = 0, envelopeIndex = 0, position = 60, length = 8, poolId = 0 }))
      assert(b.automationItem.poolId == 0 and b.pooledWith == 1 and b.automationItem.name == "Vox Chorus", "pooled instance")
      local pts = env.get_points(api, { trackIndex = 0, envelopeIndex = 0, automationItemIndex = 1 }).points
      assert(#pts == 2 and pts[1].time == 60 and pts[1].db == -1, "the second instance shows the pool's points at its own position")
      assert(env.edit_points(api, { trackIndex = 0, envelopeIndex = 0, automationItemIndex = 0 }, { { index = 0, db = -3 }, { index = 1, db = -3 } }))
      pts = env.get_points(api, { trackIndex = 0, envelopeIndex = 0, automationItemIndex = 1 }).points
      assert(pts[1].db == -3 and pts[2].db == -3, "editing the first instance edited the second")
      local list = assert(env.list_items(api, p))
      assert(list.count == 2 and list.items[1].poolId == list.items[2].poolId)
      local _, err = env.insert_item(api, { trackIndex = 0, envelopeIndex = 0, position = 90, length = 8, poolId = 0 }, { { time = 0, db = 0 } })
      assert(err:find("new pool"), tostring(err))
    `);
  });

  it('keeps a ramp to the item end inside the pool, and refuses a point outside the item', async () => {
    await runLua(`
      local api = new_fake{ tracks = { ${VOX} } }
      local p = { trackIndex = 0, envelopeIndex = 0, automationItemIndex = 0 }
      local a = assert(env.insert_item(api, { trackIndex = 0, envelopeIndex = 0, position = 54.5, length = 33.5, loop = false },
        { { time = 0, db = -2 }, { time = 32, db = -2 }, { time = 33.5, db = 0 } }))
      assert(a.automationItem.pointCount == 3, "points " .. a.automationItem.pointCount)
      local pts = env.get_points(api, p).points
      assert(near(pts[3].time, 88 - env.POOL_EDGE) and pts[3].db == 0, "the end point sits just inside the item")
      assert(env.insert_points(api, p, { { time = 88, db = 1 } }), "a point at the item end is kept")
      assert(env.get_points(api, p).total == 4)
      local writes = api.writes
      local _, err = env.insert_points(api, p, { { time = 70, db = 0 }, { time = 90, db = 0 } })
      assert(err and err:find("outside automation item 0"), tostring(err))
      _, err = env.edit_points(api, p, { { index = 0, time = 50 } })
      assert(err and err:find("outside"), tostring(err))
      assert(api.writes == writes and env.get_points(api, p).total == 4, "a refused request changes nothing")
    `);
  });

  it('a new pool gets an id no automation item in the project uses; pools reach across tracks', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Gtr", envs = { { name = "Volume", mode = 1, ais = { { pool = 4, pos = 0, len = 1 } } } } }, ${VOX} } }
      local r = assert(env.insert_item(api, { trackIndex = 1, envelopeIndex = 0, position = 0, length = 2 }, { { time = 0, db = 0 } }))
      assert(r.automationItem.poolId == 5, "pool " .. r.automationItem.poolId)
      local other = assert(env.insert_item(api, { trackIndex = 0, envelopeIndex = 0, position = 10, length = 2, poolId = 5 }))
      assert(other.pooledWith == 1, "an instance on another track counts: " .. other.pooledWith)
    `);
  });

  it('validates automation items before writing', async () => {
    await runLua(`
      local api = new_fake{ tracks = { ${VOX} } }
      local cases = {
        { { trackIndex = 0, envelopeIndex = 0, position = 1, length = 0 }, "length" },
        { { trackIndex = 0, envelopeIndex = 0, position = 1, length = 4 }, "time must be", { { time = 5, db = 0 } } },
        { { trackIndex = 0, envelopeIndex = 0, position = 1, length = 4, baseline = 2 }, "baseline" },
        { { trackIndex = 0, envelopeIndex = 0, position = 1, length = 4, poolId = 1, captureEnvelope = true }, "captureEnvelope" },
        { { trackIndex = 0, envelopeIndex = 5, position = 1, length = 4 }, "out of range" },
      }
      for _, c in ipairs(cases) do
        local r, err = env.insert_item(api, c[1], c[3])
        assert(not r and tostring(err):find(c[2], 1, true), c[2] .. ": " .. tostring(err))
      end
      assert(api.writes == 0)
      local _, err = env.get_points(api, { trackIndex = 0, envelopeIndex = 0, automationItemIndex = 0 })
      assert(err:find("Automation item 0 out of range"))
    `);
  });

  it('captureEnvelope moves the underlying points into the new item', async () => {
    await runLua(`
      local api = new_fake{ tracks = { ${VOX} } }
      local r = assert(env.insert_item(api, { trackIndex = 0, envelopeIndex = 0, position = 5, length = 10, captureEnvelope = true }))
      assert(r.automationItem.pointCount == 1, "the 10 s point is now in the item")
      assert(env.get_points(api, { trackIndex = 0, envelopeIndex = 0 }).total == 2)
    `);
  });

  it('moves and renames an item, and deletes one keeping every other selection', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Vox", envs = { { name = "Volume", mode = 1, ais = {
        { pool = 1, pos = 0, len = 4, sel = 1 }, { pool = 1, pos = 10, len = 4 }, { pool = 2, pos = 20, len = 4, sel = 1 } } } } } } }
      local r = assert(env.set_item(api, { trackIndex = 0, envelopeIndex = 0, automationItemIndex = 1, length = 6, name = "Vox Verse", loop = false }))
      assert(r.automationItem.length == 6 and r.automationItem.name == "Vox Verse" and r.automationItem.loop == false)
      r = assert(env.delete_item(api, { trackIndex = 0, envelopeIndex = 0, automationItemIndex = 1 }))
      assert(r.count == 2 and r.deleted.position == 10, "the 10 s item went")
      local ais = api.tracks[1].envs[1].ais
      assert(ais[1].pos == 0 and ais[1].sel == 1 and ais[2].pos == 20 and ais[2].sel == 1, "the others are still selected")
      assert(api.actions[#api.actions] == 42086)
    `);
  });
});
