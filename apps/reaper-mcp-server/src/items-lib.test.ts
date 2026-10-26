/**
 * Unit tests for reaper/mcp_items_lib.lua, run in real Lua 5.4 (wasmoon)
 * against the fake ReaScript API (__fixtures__/fake_reaper.lua) and its
 * in-memory file system. Assertions live in the Lua snippets: a failed
 * `assert` rejects the promise.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_items_lib.lua'), 'utf8');
const PLAN_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_plan_lib.lua'), 'utf8');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_reaper.lua'), 'utf8');

const factory = new LuaFactory();

// Shared helpers: ctx(api) builds the lib's ctx; snapshot/same detect any change.
const PRELUDE = `
function ctx(api) return { plan = plan, fs = api.fake_fs() } end
function names(list) return table.concat(list, ",") end
function snapshot(api)
  local s = { writes = api.writes, files = {} }
  for k, v in pairs(api.fs.files) do s.files[k] = v end
  return s
end
function unchanged(api, s)
  if api.writes ~= s.writes then return false end
  for k, v in pairs(api.fs.files) do if s.files[k] ~= v then return false end end
  for k in pairs(s.files) do if api.fs.files[k] == nil then return false end end
  return true
end
`;

async function runLua(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    lua.global.set('PLAN_SRC', PLAN_SRC);
    await lua.doString(FAKE_SRC);
    await lua.doString(
      `items = load(LIB_SRC, "mcp_items_lib.lua")()\nplan = load(PLAN_SRC, "mcp_plan_lib.lua")()\n${PRELUDE}\n${snippet}`,
    );
  } finally {
    lua.global.close();
  }
}

describe('mcp_items_lib.lua (wasmoon)', () => {
  it('items: insert audio file at a position, source is that file', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Gtr", items = 1 } }, audio = { ["/s/hit.wav"] = 2.5 }, cursor = 7 }
      local r, err = items.insert_audio_file(api, { trackIndex = 0, filePath = "/s/hit.wav", position = 4 }, ctx(api))
      assert(r, tostring(err))
      local tr = api.tracks[1]
      assert(#tr.items == 2, "one new item")
      assert(r.position == 4 and r.length == 2.5, "position and source length: " .. r.position .. " " .. r.length)
      assert(r.sourceFile == "/s/hit.wav" and r.takeName == "hit.wav")
      assert(r.itemIndex == 1 and tr.items[2].takes[1].src.path == "/s/hit.wav")
      assert(api.undo[#api.undo] == "MCP: Insert audio file hit.wav", "one undo point")

      local at_cursor = items.insert_audio_file(api, { trackIndex = 0, filePath = "/s/hit.wav" }, ctx(api))
      assert(at_cursor.position == 7, "defaults to the edit cursor")
    `);
  });

  it('items: takes and active take', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Vox", items = 1 } }, takes = { [1] = { [1] = { "Comp A", "Comp B", "Comp C" } } } }
      local l = items.list_takes(api, { trackIndex = 0, itemIndex = 0 })
      assert(#l.takes == 3 and l.activeTakeIndex == 0 and l.takes[1].active and l.takes[2].name == "Comp B")
      local r, err = items.set_active_take(api, { trackIndex = 0, itemIndex = 0, takeIndex = 2 })
      assert(r, tostring(err))
      assert(r.activeTakeIndex == 2 and r.takes[3].active and not r.takes[1].active, "active take reads back")
      assert(items.list_takes(api, { trackIndex = 0, itemIndex = 0 }).activeTakeIndex == 2)
      assert(api.undo[#api.undo] == "MCP: Set active take")
    `);
  });

  it('items: take FX add, set and remove', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Vox", items = 1 } }, takes = { [1] = { [1] = { "A", "B" } } } }
      local p = { trackIndex = 0, itemIndex = 0, takeIndex = 1 }
      local a = items.add_take_fx(api, { trackIndex = 0, itemIndex = 0, takeIndex = 1, fxName = "ReaEQ" })
      assert(a and a.fxIndex == 0 and a.fx[1].name == "ReaEQ" and a.takeIndex == 1)
      items.add_take_fx(api, { trackIndex = 0, itemIndex = 0, takeIndex = 1, fxName = "ReaComp" })
      assert(#api.tracks[1].items[1].takes[1].fx == 0, "only take B changed")
      local s = items.set_take_fx_parameter(api, { trackIndex = 0, itemIndex = 0, takeIndex = 1, fxIndex = 1, paramIndex = 2, value = 0.25 })
      assert(s and s.value == 0.25 and s.formatted == "0.25", "param reads back")
      local g = items.get_take_fx(api, { trackIndex = 0, itemIndex = 0, takeIndex = 1, fxIndex = 1 })
      assert(g.params[3].value == 0.25 and #g.params == 4)
      local rm = items.remove_take_fx(api, { trackIndex = 0, itemIndex = 0, takeIndex = 1, fxIndex = 0 })
      assert(rm and #rm.fx == 1 and rm.fx[1].name == "ReaComp", "chain reads back changed")
      local list = items.get_take_fx(api, p)
      assert(#list.fx == 1 and list.fx[1].name == "ReaComp")
      -- Active take by default
      local act = items.get_take_fx(api, { trackIndex = 0, itemIndex = 0 })
      assert(act.takeIndex == 0 and #act.fx == 0)
    `);
  });

  it('items: color and fades read back as set', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "Gtr", items = 1 } } }
      local p = { trackIndex = 0, itemIndex = 0 }
      assert(items.get_item_appearance(api, p).color == "none")
      local c = items.set_item_color(api, { trackIndex = 0, itemIndex = 0, color = "#FF8000" })
      assert(c and c.color == "#FF8000", "color reads back: " .. tostring(c and c.color))
      assert(api.tracks[1].items[1].vals.I_CUSTOMCOLOR == (0x0080FF | 0x1000000), "native color with the custom flag")
      local f = items.set_item_fades(api, { trackIndex = 0, itemIndex = 0, fadeInLength = 0.5, fadeInShape = 2, fadeOutLength = 1.25, fadeOutShape = 5, fadeOutCurve = -0.5 })
      assert(f and f.fadeInLength == 0.5 and f.fadeInShape == 2 and f.fadeOutLength == 1.25 and f.fadeOutShape == 5 and f.fadeOutCurve == -0.5)
      assert(f.color == "#FF8000", "fades keep the color")
      local cleared = items.set_item_color(api, { trackIndex = 0, itemIndex = 0, color = "none" })
      assert(cleared.color == "none")
    `);
  });

  it('fx: move, copy and rename', async () => {
    await runLua(`
      local api = new_fake{ tracks = { { name = "A", fx = { "EQ", "Comp", "Sat" } }, { name = "B", fx = { "Verb" } } } }
      local m = items.move_fx(api, { trackIndex = 0, fxIndex = 0, toIndex = 2 })
      assert(m and names(m.fx) == "Comp,Sat,EQ", "moved within the track: " .. names(m and m.fx or {}))
      local c = items.copy_fx(api, { trackIndex = 0, fxIndex = 0, toTrackIndex = 1, toIndex = 0 })
      assert(c and names(c.fx) == "Comp,Sat,EQ" and names(c.toFx) == "Comp,Verb", "copied to B")
      assert(api.tracks[2].fx[1].guid ~= api.tracks[1].fx[1].guid, "a copy is a new instance")
      local mv = items.move_fx(api, { trackIndex = 0, fxIndex = 1, toTrackIndex = 1 })
      assert(mv and names(mv.fx) == "Comp,EQ" and names(mv.toFx) == "Comp,Verb,Sat", "moved to the end of B")
      local r = items.rename_fx(api, { trackIndex = 1, fxIndex = 1, name = "Room" })
      assert(r and r.renamedName == "Room" and r.name == "Room" and names(r.fx) == "Comp,Room,Sat")
      local back = items.rename_fx(api, { trackIndex = 1, fxIndex = 1, name = "" })
      assert(back.name == "Verb" and back.renamedName == "", "empty name restores the plugin name")
    `);
  });

  it('fx: rfxchain save and load', async () => {
    await runLua(`
      local api = new_fake{ chunk_fx = true, tracks = { { name = "Src", fx = { "EQ", "Comp" } }, { name = "Dst", fx = { "Gate" } }, { name = "Empty" } } }
      local s, err = items.save_fx_chain(api, { trackIndex = 0, name = "Vocals/Lead" }, ctx(api))
      assert(s, tostring(err))
      assert(s.path == "/res/FXChains/Vocals/Lead.RfxChain" and s.fxCount == 2 and s.name == "Vocals/Lead")
      local text = api.fs.files[s.path]
      assert(text:sub(1, 12) == "BYPASS 0 0 0", "file starts at the first FX, no window header")
      assert(not text:find("<FXCHAIN") and not text:find("SHOW 0"))

      local a, e2 = items.load_fx_chain(api, { trackIndex = 1, name = "Vocals/Lead.RfxChain" }, ctx(api))
      assert(a, tostring(e2))
      assert(a.loaded == 2 and names(a.fx) == "Gate,EQ,Comp", "appended in order: " .. names(a.fx))
      assert(api.tracks[2].fx[2].guid ~= api.tracks[1].fx[1].guid, "fresh FXIDs")
      local r = items.load_fx_chain(api, { trackIndex = 1, name = "Vocals/Lead", mode = "replace" }, ctx(api))
      assert(names(r.fx) == "EQ,Comp", "replace keeps only the chain: " .. names(r.fx))
      local e = items.load_fx_chain(api, { trackIndex = 2, name = s.path }, ctx(api))
      assert(e and names(e.fx) == "EQ,Comp", "loads by absolute path onto a track with no FX chain")
      assert(api.tracks[3].name == "Empty", "the rest of the target chunk is kept")

      local l = items.list_fx_chains(api, {}, ctx(api))
      assert(l.total == 1 and l.names[1] == "Vocals/Lead")
      assert(not items.save_fx_chain(api, { trackIndex = 0, name = "Vocals/Lead" }, ctx(api)), "no silent overwrite")
      assert(items.save_fx_chain(api, { trackIndex = 0, name = "Vocals/Lead", overwrite = true }, ctx(api)))
    `);
  });

  it('fx: track template save and insert', async () => {
    await runLua(`
      local api = new_fake{ chunk_fx = true, tracks = { { name = "Bass", fx = { "EQ", "Comp" }, items = 2 }, { name = "Keys" } } }
      api.tracks[1].isbus = "1 1"
      api.tracks[1].recv = { 1 }
      local s, err = items.save_track_template(api, { trackIndex = 0, name = "Bass DI" }, ctx(api))
      assert(s, tostring(err))
      local text = api.fs.files["/res/TrackTemplates/Bass DI.RTrackTemplate"]
      assert(text and not text:find("<ITEM") and not text:find("AUXRECV"), "no items or receives by default")
      assert(text:find("ISBUS 0 0"), "not a folder start")
      assert(s.trackName == "Bass" and names(s.fx) == "EQ,Comp")

      local ins, e2 = items.insert_track_template(api, { name = "Bass DI", index = 1 }, ctx(api))
      assert(ins, tostring(e2))
      local t = api.tracks[2]
      assert(#api.tracks == 3 and t.name == "Bass" and names(ins.inserted[1].fx) == "EQ,Comp", "new track with the same name and FX")
      assert(api.tracks[3].name == "Keys", "inserted at index 1")
      assert(t.guid ~= api.tracks[1].guid and t.fx[1].guid ~= api.tracks[1].fx[1].guid, "fresh GUIDs")
      assert(#t.items == 0)
      assert(api.undo[#api.undo] == "MCP: Insert track template Bass DI")

      items.save_track_template(api, { trackIndex = 0, name = "Bass full", includeItems = true }, ctx(api))
      local full = items.insert_track_template(api, { name = "Bass full" }, ctx(api))
      assert(full.inserted[1].index == 3 and #api.tracks[4].items == 2, "includeItems keeps items; default index is the end")
      local l = items.list_track_templates(api, {}, ctx(api))
      assert(l.total == 2 and l.names[1] == "Bass DI" and l.names[2] == "Bass full")
    `);
  });

  it('items: refusals change nothing', async () => {
    await runLua(`
      local api = new_fake{
        chunk_fx = true, missing_fx = "Nope", audio = { ["/s/ok.wav"] = 1 },
        files = { ["/s/notes.txt"] = "hello", ["/res/FXChains/Empty.RfxChain"] = "WNDRECT 0 0 0 0\\n" },
        tracks = { { name = "A", fx = { "EQ" }, items = 1 }, { name = "B" } },
      }
      local c = ctx(api)
      local before = snapshot(api)
      -- refused(label, want, r, err): the call goes last so both of its results arrive.
      local function refused(label, want, r, err)
        assert(r == nil, label .. ": should be refused")
        assert(type(err) == "string" and err:find(want, 1, true), label .. ": '" .. tostring(err) .. "' should mention '" .. want .. "'")
        assert(unchanged(api, before), label .. ": changed something")
      end
      -- missing / unreadable file
      refused("missing file", "file not found", items.insert_audio_file(api, { trackIndex = 0, filePath = "/s/nope.wav" }, c))
      refused("not audio", "cannot read", items.insert_audio_file(api, { trackIndex = 0, filePath = "/s/notes.txt" }, c))
      refused("unknown track", "Track 9 not found", items.insert_audio_file(api, { trackIndex = 9, filePath = "/s/ok.wav" }, c))
      -- unknown take / FX / item
      refused("unknown take", "Take 5 not found", items.set_active_take(api, { trackIndex = 0, itemIndex = 0, takeIndex = 5 }))
      refused("unknown item", "Item 3 not found", items.list_takes(api, { trackIndex = 0, itemIndex = 3 }))
      refused("unknown take FX", "FX 0 not found", items.remove_take_fx(api, { trackIndex = 0, itemIndex = 0, fxIndex = 0 }))
      refused("unknown take FX param", "FX 0 not found", items.set_take_fx_parameter(api, { trackIndex = 0, itemIndex = 0, fxIndex = 0, paramIndex = 0, value = 1 }))
      refused("uninstalled take FX", "FX not found", items.add_take_fx(api, { trackIndex = 0, itemIndex = 0, fxName = "Nope" }))
      refused("unknown FX move", "FX 4 not found", items.move_fx(api, { trackIndex = 0, fxIndex = 4 }))
      refused("bad toIndex", "toIndex must be 0-0", items.copy_fx(api, { trackIndex = 0, fxIndex = 0, toTrackIndex = 1, toIndex = 3 }))
      refused("unknown FX rename", "FX 0 not found", items.rename_fx(api, { trackIndex = 1, fxIndex = 0, name = "X" }))
      refused("bad color", "#RRGGBB", items.set_item_color(api, { trackIndex = 0, itemIndex = 0, color = "red" }))
      refused("bad shape", "integer 0-6", items.set_item_fades(api, { trackIndex = 0, itemIndex = 0, fadeInLength = 1, fadeInShape = 9 }))
      -- write paths outside the resource dir
      refused("absolute write", "outside REAPER's FXChains folder", items.save_fx_chain(api, { trackIndex = 0, name = "/tmp/x" }, c))
      refused("dotdot write", "outside REAPER's FXChains folder", items.save_fx_chain(api, { trackIndex = 0, name = "../../evil" }, c))
      refused("windows write", "outside REAPER's TrackTemplates folder", items.save_track_template(api, { trackIndex = 0, name = "C:\\\\evil" }, c))
      refused("backslash dotdot", "outside REAPER's TrackTemplates folder", items.save_track_template(api, { trackIndex = 0, name = "a\\\\..\\\\..\\\\evil" }, c))
      refused("no FX to save", "no FX", items.save_fx_chain(api, { trackIndex = 1, name = "x" }, c))
      -- missing or empty chain / template
      refused("missing chain", "file not found", items.load_fx_chain(api, { trackIndex = 1, name = "Nope" }, c))
      refused("empty chain", "holds no FX", items.load_fx_chain(api, { trackIndex = 1, name = "Empty" }, c))
      refused("wrong extension", "not a .RfxChain file", items.load_fx_chain(api, { trackIndex = 1, name = "/s/notes.txt" }, c))
      refused("missing template", "file not found", items.insert_track_template(api, { name = "Nope" }, c))
      -- an empty take slot (REAPER's GetTake returns nil) is an error, not a nil success
      local it = api.tracks[1].items[1]
      it.takes[2] = false
      refused("empty take slot", "empty take slot", items.set_active_take(api, { trackIndex = 0, itemIndex = 0, takeIndex = 1 }))
      refused("empty take slot FX", "empty take slot", items.get_take_fx(api, { trackIndex = 0, itemIndex = 0, takeIndex = 1 }))
      local lt = items.list_takes(api, { trackIndex = 0, itemIndex = 0 })
      assert(#lt.takes == 2 and lt.takes[2].empty == true, "list_takes marks the empty slot")
      it.takes[2] = nil
      assert(#api.tracks == 2 and #api.tracks[1].items == 1 and #api.tracks[1].fx == 1)
    `);
  });
});
