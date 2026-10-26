/**
 * Unit tests for reaper/mcp_project_lib.lua, run in real Lua 5.4 (wasmoon)
 * against the fake ReaScript API (__fixtures__/fake_reaper.lua).
 * Assertions live in the Lua snippets: a failed `assert` rejects the promise.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_project_lib.lua'), 'utf8');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_reaper.lua'), 'utf8');

const factory = new LuaFactory();

async function runLua(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    await lua.doString(FAKE_SRC);
    await lua.doString(`project = load(LIB_SRC, "mcp_project_lib.lua")()\n${snippet}`);
  } finally {
    lua.global.close();
  }
}

describe('mcp_project_lib.lua (wasmoon)', () => {
  it('project: undo and redo revert and restore an edit and report its label', async () => {
    await runLua(`
      local api = new_fake{}
      local _, none = project.undo(api)
      assert(none == "nothing to undo", tostring(none))
      local _, noredo = project.redo(api)
      assert(noredo == "nothing to redo", tostring(noredo))

      assert(project.add_tempo_marker(api, { position = 8, bpm = 140 }))
      assert(project.tempo_map(api).tempoMarkerCount == 1, "edit applied")

      local u = assert(project.undo(api))
      assert(u.undone == "MCP: Add tempo marker", tostring(u.undone))
      assert(project.tempo_map(api).tempoMarkerCount == 0, "undo reverted the edit")
      assert(u.nextRedo == "MCP: Add tempo marker" and u.nextUndo == nil)

      local r = assert(project.redo(api))
      assert(r.redone == "MCP: Add tempo marker", tostring(r.redone))
      local m = project.tempo_map(api).markers[1]
      assert(m.bpm == 140 and m.position == 8, "redo restored the edit")
      assert(r.nextUndo == "MCP: Add tempo marker" and r.nextRedo == nil)
    `);
  });

  it('project: save refuses a never-saved project without a path, and writes the file with one', async () => {
    await runLua(`
      local fs = new_fs{ dirs = { "/tmp/songs" }, files = { "/tmp/songs/other.rpp" } }
      local api = new_fake{ fs = fs }
      local _, err = project.save(api, {}, fs)
      assert(err and err:find("refused") and err:find("never saved"), tostring(err))
      assert((api.saved or 0) == 0, "no save call (it would open a dialog)")

      local _, e2 = project.save(api, { path = "/tmp/songs/a.txt" }, fs)
      assert(e2:find("%.rpp"), e2)
      local _, e3 = project.save(api, { path = "/nope/a.rpp" }, fs)
      assert(e3:find("does not exist"), e3)
      local _, e4 = project.save(api, { path = "songs/a.rpp" }, fs)
      assert(e4:find("absolute"), e4)
      local _, e5 = project.save(api, { path = "/tmp/songs/other.rpp" }, fs)
      assert(e5:find("already exists"), e5)
      assert((api.saved or 0) == 0, "refusals saved nothing")

      local ok = assert(project.save(api, { path = "/tmp/songs/new.RPP" }, fs))
      assert(ok.saved and fs.exists("/tmp/songs/new.RPP"), "file exists after save with a path")
      assert(project.save(api, { path = "/tmp/songs/other.rpp", overwrite = true }, fs).saved)

      local saved = new_fake{ fs = fs, project_path = "/tmp/songs/song.rpp" }
      local s = assert(project.save(saved, {}, fs))
      assert(s.path == "/tmp/songs/song.rpp" and fs.exists("/tmp/songs/song.rpp"), "saved in place")
    `);
  });

  it('project: render settings read back as set, and render_project writes the target', async () => {
    await runLua(`
      local fs = new_fs{ dirs = { "/tmp/out" } }
      local api = new_fake{ fs = fs }
      local before = project.get_render(api)
      assert(before.format == "wav" and before.bounds == "project", before.format .. " " .. before.bounds)

      local r = assert(project.set_render(api, {
        outputDirectory = "/tmp/out", filePattern = "mix", format = "flac", bounds = "custom",
        startTime = 1, endTime = 3.5, sampleRate = 48000, channels = 1,
      }))
      assert(r.outputDirectory == "/tmp/out" and r.filePattern == "mix", "dir + pattern")
      assert(r.format == "flac", "format read back: " .. tostring(r.format))
      assert(r.bounds == "custom" and r.startTime == 1 and r.endTime == 3.5, "bounds")
      assert(r.sampleRate == 48000 and r.channels == 1, "rate + channels")
      assert(r.targets[1] == "/tmp/out/mix.flac", tostring(r.targets[1]))
      local again = project.get_render(api)
      assert(again.format == "flac" and again.sampleRate == 48000, "get_render agrees")
      for _, f in ipairs({ "wav", "aiff", "mp3", "ogg", "opus", "FLAC" }) do
        assert(project.set_render(api, { format = f }).format == f:lower(), "round-trips " .. f)
      end
      project.set_render(api, { format = "flac" })
      assert(project.get_render(api).secondaryFormat == "none", "no secondary format by default")
      assert(project.set_render(api, { secondaryFormat = "mp3" }).secondaryFormat == "mp3", "secondary format set")
      assert(project.set_render(api, { secondaryFormat = "none" }).secondaryFormat == "none", "secondary format cleared")

      local out = assert(project.render(api, {}, fs))
      assert(out.files[1] == "/tmp/out/mix.flac" and fs.exists("/tmp/out/mix.flac"), "render wrote the target")
      assert(api.commands[#api.commands] == 42230, "rendered with action 42230")

      local n = #api.commands
      local _, exists = project.render(api, {}, fs)
      assert(exists and exists:find("already exists"), tostring(exists))
      assert(#api.commands == n, "no render over an existing file (REAPER would prompt)")
      assert(project.render(api, { overwrite = true }, fs).rendered and fs.removed[1] == "/tmp/out/mix.flac")

      project.set_render(api, { bounds = "time_selection" })
      local _, nosel = project.render(api, { overwrite = true }, fs)
      assert(nosel and nosel:find("no time selection"), tostring(nosel))
      local video = new_fake{ fs = fs, project = { strings = { RENDER_FILE = "/tmp/out", RENDER_PATTERN = "v",
        RENDER_FORMAT2 = b64encode(" FMW\0\0\0\0") } } }
      local _, vid = project.render(video, {}, fs)
      assert(vid and vid:find("other:") and #video.commands == 0, "unknown encoder refused: " .. tostring(vid))
      local rel = new_fake{ fs = fs }
      local _, relerr = project.render(rel, {}, fs)
      assert(relerr and relerr:find("not an absolute path"), tostring(relerr))
    `);
  });

  it('project: settings and transport options read back as set', async () => {
    await runLua(`
      local api = new_fake{}
      local s = assert(project.set_settings(api, {
        sampleRate = 48000, useProjectSampleRate = true, title = "Song", author = "Me",
        notes = "line 1\\nline 2", ["repeat"] = true, metronome = true,
      }))
      assert(s.sampleRate == 48000 and s.useProjectSampleRate == true, "sample rate")
      assert(s.title == "Song" and s.author == "Me" and s.notes == "line 1\\nline 2", "strings")
      assert(s["repeat"] == true and s.metronome == true, "transport options on")
      local g = project.get_settings(api)
      assert(g.sampleRate == 48000 and g["repeat"] == true and g.metronome == true, "get agrees")

      local undo_points = #api.undo
      local off = project.set_settings(api, { ["repeat"] = false, metronome = false })
      assert(off["repeat"] == false and off.metronome == false, "transport options off")
      assert(#api.undo == undo_points, "transport-only change adds no undo point")
      local cmds = #api.commands
      project.set_settings(api, { metronome = false })
      assert(#api.commands == cmds, "metronome already off: not toggled")
    `);
  });

  it('tempo: add, edit and delete markers and set the tempo show in the tempo map', async () => {
    await runLua(`
      local api = new_fake{}
      local t0 = project.set_tempo(api, { bpm = 98 })
      assert(t0.markers[1].bpm == 98 and t0.tempoMarkerCount == 0, "project tempo set with no markers")

      local a = assert(project.add_tempo_marker(api, { position = 0, bpm = 100 }))
      a = assert(project.add_tempo_marker(api, { position = 10, bpm = 150, timeSigNumerator = 3, timeSigDenominator = 4 }))
      assert(a.count == 2 and a.markers[2].bpm == 150 and a.markers[2].timeSigNumerator == 3, "added")

      local e = assert(project.edit_tempo_marker(api, { index = 1, bpm = 160, position = 12, linear = true }))
      assert(e.markers[2].bpm == 160 and e.markers[2].position == 12 and e.markers[2].linearTempo == true, "edited")
      assert(e.markers[2].timeSigNumerator == 3, "unchanged fields kept")

      local st = assert(project.set_tempo(api, { bpm = 90 }))
      assert(st.markers[1].bpm == 90 and st.markers[2].bpm == 160, "set_tempo edits the first marker when markers exist")

      local d = assert(project.delete_tempo_marker(api, { index = 1 }))
      assert(d.count == 1 and d.markers[1].bpm == 90, "deleted")
      assert(api.undo[#api.undo] == "MCP: Delete tempo marker")

      local rep = assert(project.add_tempo_marker(api, { position = 0, bpm = 101 }))
      assert(rep.replacedExisting == true and rep.count == 1 and rep.markers[1].bpm == 101, "same position replaces")

      local late = new_fake{ project = { tempo_markers = { { time = 4, bpm = 140 } } } }
      local l = assert(project.set_tempo(late, { bpm = 99 }))
      assert(l.count == 2 and l.markers[1].position == 0 and l.markers[1].bpm == 99 and l.markers[2].bpm == 140,
        "first marker later than 0: a start marker is added, the later one kept")

      local sticky = new_fake{ project = { sticky_start = true, tempo_markers = { { time = 0, bpm = 120, num = 4, den = 4 }, { time = 4, bpm = 140 } } } }
      local _, kept = project.delete_tempo_marker(sticky, { index = 0 })
      assert(kept and kept:find("did not delete"), "a delete REAPER ignores is reported: " .. tostring(kept))
      assert(project.tempo_map(sticky).tempoMarkerCount == 2)
    `);
  });

  it('markers: edit markers and regions — rename, move, recolor', async () => {
    await runLua(`
      local api = new_fake{ project = { markers = {
        { pos = 1, name = "Verse" }, { pos = 5, name = "Chorus" },
        { rgn = true, pos = 0, rend = 8, name = "Intro" },
      } } }
      local m = assert(project.edit_marker(api, { markerIndex = 2, name = "Hook", position = 6.5, color = 255 }))
      assert(m.name == "Hook" and m.position == 6.5 and m.color == (255 | 0x1000000), "marker edited")
      local kept = assert(project.edit_marker(api, { markerIndex = 1, position = 2 }))
      assert(kept.name == "Verse" and kept.position == 2, "name kept when only moving")
      local cleared = assert(project.edit_marker(api, { markerIndex = 1, name = "" }))
      assert(cleared.name == "", "empty name clears it")

      local r = assert(project.edit_region(api, { regionIndex = 1, name = "Intro 2", start = 0.5, ["end"] = 9, color = 65280 }))
      assert(r.name == "Intro 2" and r.start == 0.5 and r["end"] == 9 and r.color == (65280 | 0x1000000), "region edited")
      assert(api.undo[#api.undo] == "MCP: Edit region")

      -- list order follows position: Verse(2) < Hook(6.5)
      local _, _, pos, _, name, num = api.EnumProjectMarkers3(0, 2)
      assert(name == "Hook" and num == 2 and pos == 6.5, "enumeration shows the move")
    `);
  });

  it('project: refusals change nothing — unknown marker, bad tempo, unsupported format', async () => {
    await runLua(`
      local fs = new_fs{ dirs = { "/tmp/out" } }
      local api = new_fake{ fs = fs, project = {
        markers = { { pos = 1, name = "A" }, { rgn = true, pos = 0, rend = 4, name = "R" } },
        tempo_markers = { { time = 0, bpm = 120 } },
      } }
      local w = api.writes
      local function refused(want, res, err)
        assert(res == nil and err and err:find(want), "expected '" .. want .. "', got " .. tostring(err))
        assert(api.writes == w, "wrote after refusal: " .. want)
        assert(#api.undo == 0, "no undo point after refusal: " .. want)
      end

      refused("no marker 9", project.edit_marker(api, { markerIndex = 9, name = "x" }))
      refused("end must be after start", project.edit_region(api, { regionIndex = 1, start = 5, ["end"] = 2 }))
      refused("no region 7", project.edit_region(api, { regionIndex = 7 }))
      refused("position must be", project.edit_marker(api, { markerIndex = 1, position = -1 }))

      refused("bpm must be > 0", project.add_tempo_marker(api, { position = 4, bpm = 0 }))
      refused("bpm must be > 0", project.add_tempo_marker(api, { position = 4, bpm = -10 }))
      refused("bpm must be > 0", project.set_tempo(api, { bpm = 0 }))
      refused("bpm must be > 0", project.edit_tempo_marker(api, { index = 0, bpm = -1 }))
      refused("no tempo marker 5", project.edit_tempo_marker(api, { index = 5, bpm = 100 }))
      refused("no tempo marker 3", project.delete_tempo_marker(api, { index = 3 }))
      refused("together", project.add_tempo_marker(api, { position = 4, bpm = 100, timeSigNumerator = 3 }))
      refused("timeSigDenominator", project.add_tempo_marker(api, { position = 4, bpm = 100, timeSigNumerator = 3, timeSigDenominator = 5 }))
      assert(project.tempo_map(api).markers[1].bpm == 120, "tempo map unchanged")

      local before = project.get_render(api)
      refused("unsupported render format 'wma'", project.set_render(api, { format = "wma", outputDirectory = "/tmp/out", channels = 1 }))
      refused("unknown bounds", project.set_render(api, { bounds = "everything" }))
      refused("unsupported secondary render format", project.set_render(api, { secondaryFormat = "wmv", format = "wav" }))
      refused("sampleRate", project.set_render(api, { sampleRate = 12 }))
      refused("channels", project.set_render(api, { channels = 0 }))
      refused("endTime must be after", project.set_render(api, { startTime = 5, endTime = 1 }))
      local after = project.get_render(api)
      assert(after.format == before.format and after.outputDirectory == before.outputDirectory and after.channels == before.channels, "render settings unchanged")

      refused("sampleRate", project.set_settings(api, { sampleRate = 100, title = "x" }))
      refused("repeat must be true or false", project.set_settings(api, { ["repeat"] = "yes" }))
      assert(project.get_settings(api).title == "", "settings unchanged")
    `);
  });
});
