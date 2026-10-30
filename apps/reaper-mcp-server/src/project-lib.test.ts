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
const PLAN_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_plan_lib.lua'), 'utf8');

const factory = new LuaFactory();

async function runLua(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    lua.global.set('PLAN_SRC', PLAN_SRC);
    await lua.doString(FAKE_SRC);
    await lua.doString(`project = load(LIB_SRC, "mcp_project_lib.lua")()\nresolve = load(PLAN_SRC, "mcp_plan_lib.lua")().resolve_track\n${snippet}`);
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

  it('project: tempo map without markers reports the project time signature, not the tempo', async () => {
    await runLua(`
      local api = new_fake{ project = { tempo = 96, num = 7, den = 8 } }
      local m = project.tempo_map(api).markers[1]
      assert(m.timeSigNumerator == 7 and m.timeSigDenominator == 8, m.timeSigNumerator .. "/" .. m.timeSigDenominator)
      assert(m.bpm == 96)
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
      assert(ok.savedAsCopy == true and ok.projectPath == "", "a path writes a copy; the project keeps its own path")
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
      local stuck = setmetatable({ remove = function() end }, { __index = fs })
      local m = #api.commands
      local _, locked = project.render(api, { overwrite = true }, stuck)
      assert(locked and locked:find("could not delete") and #api.commands == m, "no render when the delete fails: " .. tostring(locked))
      local get_string = api.GetSetProjectInfo_String
      api.GetSetProjectInfo_String = function(p, key, v, set)
        if key == "RENDER_TARGETS" then return true, "/tmp/out/mix.flac;/tmp/out/mix.mp3" end
        return get_string(p, key, v, set)
      end
      fs.files["/tmp/out/mix.mp3"] = true
      local half = setmetatable({ remove = function(p) if p:find("%.flac$") then fs.remove(p) end end }, { __index = fs })
      local _, partial = project.render(api, { overwrite = true }, half)
      assert(partial and partial:find("could not delete /tmp/out/mix.mp3") and partial:find("already deleted: /tmp/out/mix.flac"), tostring(partial))
      api.GetSetProjectInfo_String = get_string
      fs.files["/tmp/out/mix.mp3"] = nil

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
  // ── Delivery: render source, format options, normalize, metadata, versions ──

  const DELIVERY = `
    local fs = new_fs{ dirs = { "/tmp/out" } }
    local api = new_fake{ fs = fs, tracks = { { name = "Drums" }, { name = "Bass" }, { name = "Vocals" } },
      project = { markers = { { pos = 0, rend = 10, rgn = true, name = "Verse" }, { pos = 10, rend = 20, rgn = true, name = "Chorus" } } } }
    assert(project.set_render(api, { outputDirectory = "/tmp/out", filePattern = "song", format = "wav" }))
    local function refused(what, ok, err)
      assert(ok == nil and err and err:find(what, 1, true) and err:find("nothing"), "expected refusal '" .. what .. "', got " .. tostring(err))
    end
  `;

  it('render source: each source is written and read back; stems list the selected tracks', async () => {
    await runLua(`${DELIVERY}
      assert(project.get_render(api).source == "master", "master by default")
      for _, src in ipairs({ "stems", "master_and_stems", "selected_via_master", "selected_items", "master" }) do
        assert(project.set_render(api, { source = src }).source == src, "round-trips " .. src)
      end
      api.SetTrackSelected(api.GetTrack(0, 0), true)
      api.SetTrackSelected(api.GetTrack(0, 2), true)
      local r = project.set_render(api, { source = "stems", filePattern = "$track" })
      assert(#r.targets == 2 and r.targets[1] == "/tmp/out/Drums.wav" and r.targets[2] == "/tmp/out/Vocals.wav", table.concat(r.targets, ","))
      r = project.set_render(api, { source = "master_and_stems" })
      assert(#r.targets == 3 and r.targets[1] == "/tmp/out/Master.wav", table.concat(r.targets, ","))
      assert(math.floor(api.project.info.RENDER_SETTINGS) == 1, "master + stems is RENDER_SETTINGS 1")
      project.set_render(api, { source = "stems" })
      assert(math.floor(api.project.info.RENDER_SETTINGS) == 3, "stems of the selected tracks is 3, not 2 (REAPER 7 lists nothing for 2)")
    `);
  });

  it('render source: region_matrix needs region bounds and replaces the rows it is given', async () => {
    await runLua(`${DELIVERY}
      local w = api.writes
      refused("set bounds to all_regions", project.set_render(api, { source = "region_matrix" }, resolve))
      refused("regionMatrix applies to source region_matrix", project.set_render(api, { regionMatrix = { { regionIndex = 1, tracks = { "Drums" } } } }, resolve))
      refused("no region 9", project.set_render(api, { source = "region_matrix", bounds = "all_regions", regionMatrix = { { regionIndex = 9, tracks = { "Drums" } } } }, resolve))
      refused("'Nope' not found", project.set_render(api, { source = "region_matrix", bounds = "all_regions", regionMatrix = { { regionIndex = 1, tracks = { "Nope" } } } }, resolve))
      assert(api.writes == w, "refusals wrote nothing")
      local r = assert(project.set_render(api, { source = "region_matrix", bounds = "all_regions",
        regionMatrix = { { regionIndex = 1, tracks = { "Drums", "master" } }, { regionIndex = 2, tracks = { 2 } } } }, resolve))
      assert(r.source == "region_matrix" and #r.regionMatrix == 2, "two rows")
      assert(r.regionMatrix[1].name == "Verse" and r.regionMatrix[1].tracks[1] == "Drums" and r.regionMatrix[1].tracks[2] == "master")
      assert(r.targets[1] == "/tmp/out/Verse-Drums.wav" and #r.targets == 3, table.concat(r.targets, ","))
      r = project.set_render(api, { regionMatrix = { { regionIndex = 1, tracks = { "Bass" } } } }, resolve)
      assert(#r.regionMatrix[1].tracks == 1 and r.regionMatrix[1].tracks[1] == "Bass", "the row was replaced, not added to")
      assert(r.regionMatrix[2].tracks[1] == "Vocals", "other rows kept")
      w = api.writes
      refused("set bounds to all_regions", project.set_render(api, { bounds = "project" }, resolve))
      assert(api.writes == w and project.get_render(api).bounds == "all_regions", "region bounds kept while the source is region_matrix")
    `);
  });

  it('render format options: bit depth, MP3 bitrate and dither store REAPER encodings and read back', async () => {
    await runLua(`${DELIVERY}
      local function blob() return b64decode(api.project.strings.RENDER_FORMAT) end
      for depth, code in pairs({ ["16"] = 16, ["24"] = 24, ["32"] = 0x21, ["32f"] = 0x20 }) do
        local r = assert(project.set_render(api, { bitDepth = depth }))
        assert(r.bitDepth == depth and r.format == "wav", depth .. " read back as " .. tostring(r.bitDepth))
        assert(blob():sub(1, 4) == "evaw" and string.unpack("<I2", blob(), 5) == code, "wav " .. depth .. " stored as " .. code)
      end
      local r = assert(project.set_render(api, { format = "flac", bitDepth = "24" }))
      assert(r.format == "flac" and r.bitDepth == "24", "flac 24")
      assert(blob():sub(1, 4) == "calf" and string.unpack("<i4i4", blob(), 5) == 24, "calf + int32 bits")
      assert(select(2, string.unpack("<i4i4", blob(), 5)) == 5, "default compression level 5")
      assert(r.targets[1] == "/tmp/out/song.flac", "still a flac target: " .. tostring(r.targets[1]))
      r = assert(project.set_render(api, { format = "aiff", bitDepth = "16" }))
      assert(r.bitDepth == "16" and blob():sub(1, 4) == "ffia", "aiff 16")
      r = assert(project.set_render(api, { format = "mp3", mp3Bitrate = 320 }))
      assert(r.mp3Bitrate == 320, "mp3 bitrate read back")
      assert(string.unpack("<i4", blob(), 5) == 320 and string.unpack("<i4", blob(), 25) == 320, "kbps at bytes 4 and 24")
      r = assert(project.set_render(api, { mp3Bitrate = 192 }))
      assert(r.mp3Bitrate == 192 and string.unpack("<i4", blob(), 25) == 192, "a second change keeps the rest of the config")
      r = assert(project.set_render(api, { dither = true, noiseShaping = true }))
      assert(r.dither and r.noiseShaping and math.floor(api.project.info.RENDER_DITHER) == 15, "master and stems dither + noise shaping")
      r = assert(project.set_render(api, { noiseShaping = false }))
      assert(r.dither and not r.noiseShaping and math.floor(api.project.info.RENDER_DITHER) == 5)
      local w = api.writes
      refused("bitDepth applies to wav, aiff and flac", project.set_render(api, { format = "ogg", bitDepth = "24" }))
      refused("mp3 takes mp3Bitrate", project.set_render(api, { bitDepth = "24" }))
      refused("flac bitDepth must be one of 16, 24", project.set_render(api, { format = "flac", bitDepth = "32f" }))
      refused("mp3Bitrate must be one of", project.set_render(api, { mp3Bitrate = 333 }))
      refused("mp3Bitrate applies to format mp3", project.set_render(api, { format = "wav", mp3Bitrate = 320 }))
      assert(api.writes == w and project.get_render(api).format == "mp3", "refusals changed nothing")
    `);
  });

  it('render normalize: mode, target, too-loud only and the limiter read back as set', async () => {
    await runLua(`${DELIVERY}
      local r = project.get_render(api)
      assert(r.normalize == "off" and r.limit == false, "off by default")
      r = assert(project.set_render(api, { normalize = "lufs_i", normalizeTarget = -14, limit = true, limitCeiling = -1, limitTruePeak = true }))
      assert(r.normalize == "lufs_i" and r.normalizeTarget == -14, "LUFS-I -14: " .. tostring(r.normalizeTarget))
      assert(r.limit and r.limitCeiling == -1 and r.limitTruePeak, "true-peak limit at -1")
      assert(math.abs(api.project.info.RENDER_NORMALIZE_TARGET - 10 ^ (-14 / 20)) < 1e-9, "target stored as linear amplitude")
      assert(math.floor(api.project.info.RENDER_NORMALIZE) == 1 | 64 | 128, "flags")
      r = assert(project.set_render(api, { normalize = "true_peak", normalizeTarget = -1, normalizeOnlyTooLoud = true }))
      assert(r.normalize == "true_peak" and r.normalizeOnlyTooLoud and r.limit, "mode changed, limiter kept")
      r = assert(project.set_render(api, { normalize = "off", limit = false }))
      assert(r.normalize == "off" and not r.limit and r.normalizeTarget == -1, "off keeps the target for next time")
      local fresh = new_fake{ fs = fs }
      refused("normalize needs normalizeTarget", project.set_render(fresh, { normalize = "peak" }))
      refused("limit needs limitCeiling", project.set_render(fresh, { limit = true }))
      refused("normalizeTarget must be -70 to 0", project.set_render(api, { normalize = "lufs_i", normalizeTarget = 3 }))
      refused("unknown normalize 'loud'", project.set_render(api, { normalize = "loud" }))
    `);
  });

  it('render metadata: friendly fields write their keys, enable embedding, and an empty value clears', async () => {
    await runLua(`${DELIVERY}
      local r = assert(project.set_render(api, { metadata = { title = "Night Drive", artist = "Mads", isrc = "USABC2600001", description = "Final master" },
        metadataRaw = { ["ID3:TCOM"] = "M. Thines" } }))
      assert(r.embedMetadata == true and math.floor(api.project.info.RENDER_SETTINGS) & 512 ~= 0, "embedding turned on")
      assert(r.metadata["ID3:TIT2"] == "Night Drive" and r.metadata["INFO:INAM"] == "Night Drive" and r.metadata["VORBIS:TITLE"] == "Night Drive", "title in every scheme")
      assert(r.metadata["ID3:TSRC"] == "USABC2600001" and r.metadata["AXML:ISRC"] == "USABC2600001", "ISRC in ID3 and AXML")
      assert(r.metadata["BWF:Description"] == "Final master" and r.metadata["ID3:TCOM"] == "M. Thines", "BWF + raw key")
      r = assert(project.set_render(api, { metadata = { title = "" } }))
      assert(r.metadata["ID3:TIT2"] == nil and r.metadata["ID3:TPE1"] == "Mads", "title cleared, artist kept")
      r = assert(project.set_render(api, { embedMetadata = false }))
      assert(r.embedMetadata == false and r.metadata["ID3:TPE1"] == "Mads", "embedding off keeps the stored metadata")
      local w = api.writes
      refused("unknown metadata field 'mood'", project.set_render(api, { metadata = { mood = "happy" } }))
      refused("must look like SCHEME:FIELD", project.set_render(api, { metadataRaw = { ["bad key"] = "x" } }))
      refused("one line", project.set_render(api, { metadata = { comment = "a\\nb" } }))
      assert(api.writes == w, "refusals wrote nothing")
    `);
  });

  it('render analysis: each file comes back measured, and tracks select the stems for that render only', async () => {
    await runLua(`${DELIVERY}
      local m = new_fake{ fs = fs, levels = { lufs = -9.25, truePeak = -0.4, peak = -0.9 } }
      project.set_render(m, { outputDirectory = "/tmp/out", filePattern = "mix", normalize = "lufs_i", normalizeTarget = -9, limit = true, limitCeiling = -0.5 })
      m.render_seconds = 184.2
      local out = assert(project.render(m, {}, fs, resolve))
      local a = out.analysis[1]
      assert(a.file == "/tmp/out/mix.wav" and a.durationSeconds == 184.2, "duration " .. tostring(a.durationSeconds))
      assert(a.lufsIntegrated == -9.25 and a.truePeak == -0.4 and a.samplePeak == -0.9, "levels " .. tostring(a.lufsIntegrated))
      assert(out.normalize == "lufs_i" and out.normalizeTarget == -9 and out.limitCeiling == -0.5, "the targets travel with the result")
      local quiet = assert(project.render(m, { overwrite = true, analyze = false }, fs, resolve))
      assert(quiet.analysis == nil and quiet.rendered, "analyze false skips measuring")

      api.SetTrackSelected(api.GetTrack(0, 1), true)
      project.set_render(api, { source = "stems", filePattern = "$track" })
      local st = assert(project.render(api, { tracks = { "Drums", "Vocals" } }, fs, resolve))
      assert(#st.files == 2 and st.files[1] == "/tmp/out/Drums.wav" and st.files[2] == "/tmp/out/Vocals.wav", table.concat(st.files, ","))
      local log = api.render_log[#api.render_log]
      assert(#log.selected == 2 and log.selected[1] == "Drums", "the render saw only the requested tracks selected")
      assert(api.IsTrackSelected(api.GetTrack(0, 1)) and not api.IsTrackSelected(api.GetTrack(0, 0)), "selection restored after the render")
      local _, unknown = project.render(api, { tracks = { "Nope" }, overwrite = true }, fs, resolve)
      assert(unknown and unknown:find("not found"), tostring(unknown))
      local _, exist = project.render(api, { tracks = { "Drums" } }, fs, resolve)
      assert(exist and exist:find("already exists") and api.IsTrackSelected(api.GetTrack(0, 1)), "refused, selection still restored")
      project.set_render(api, { source = "master" })
      local _, notstems = project.render(api, { tracks = { "Drums" } }, fs, resolve)
      assert(notstems and notstems:find("tracks applies to source stems"), tostring(notstems))
      api.SetTrackSelected(api.GetTrack(0, 1), false)
      project.set_render(api, { source = "stems" })
      local _, nosel = project.render(api, {}, fs, resolve)
      assert(nosel and nosel:find("none is selected"), tostring(nosel))
      project.set_render(api, { source = "selected_items" })
      local _, noitems = project.render(api, {}, fs, resolve)
      assert(noitems and noitems:find("set_selected_items"), tostring(noitems))
    `);
  });

  it('render versions: one render per version with its tracks muted, then mutes and pattern restored', async () => {
    await runLua(`${DELIVERY}
      api.SetMediaTrackInfo_Value(api.GetTrack(0, 1), "B_MUTE", 1) -- the user had Bass muted
      local out = assert(project.render_versions(api, { versions = {
        { name = "Instrumental", mute = { "Vocals" } },
        { name = "A cappella", mute = { "Drums", "Bass" } },
        { name = "TV", mute = {}, filePattern = "song_tv" },
      } }, fs, resolve))
      assert(#out.versions == 3, "three versions")
      assert(out.versions[1].files[1] == "/tmp/out/song-Instrumental.wav" and out.versions[3].files[1] == "/tmp/out/song_tv.wav", out.versions[1].files[1])
      assert(out.versions[1].analysis[1].lufsIntegrated == -14, "each version measured")
      local l = api.render_log
      assert(#l == 3 and table.concat(l[1].muted, ",") == "Bass,Vocals", "instrumental: vocals muted on top of the user's mutes: " .. table.concat(l[1].muted, ","))
      assert(table.concat(l[2].muted, ",") == "Drums,Bass", table.concat(l[2].muted, ","))
      assert(out.versions[2].muted[1] == "Drums", "muted names reported")
      assert(api.GetMediaTrackInfo_Value(api.GetTrack(0, 2), "B_MUTE") == 0 and api.GetMediaTrackInfo_Value(api.GetTrack(0, 1), "B_MUTE") == 1, "mutes restored")
      assert(api.project.strings.RENDER_PATTERN == "song", "pattern restored")
    `);
  });

  it('render versions: a version that mutes the master leaves the next version unmuted', async () => {
    await runLua(`${DELIVERY}
      assert(project.render_versions(api, { versions = { { name = "Silent", mute = { "master" } }, { name = "Full" } } }, fs, resolve))
      assert(api.render_log[1].masterMuted and not api.render_log[2].masterMuted, "master muted only for its own version")
      assert(api.GetMediaTrackInfo_Value(api.GetMasterTrack(0), "B_MUTE") == 0, "master restored")
    `);
  });

  it('render versions: an MP3 render reports its bitrate, like render_project', async () => {
    await runLua(`${DELIVERY}
      assert(project.set_render(api, { format = "mp3", mp3Bitrate = 320 }))
      local out = assert(project.render_versions(api, { versions = { { name = "Full" } } }, fs, resolve))
      assert(out.format == "mp3" and out.mp3Bitrate == 320, "bitrate in the answer: " .. tostring(out.mp3Bitrate))
    `);
  });

  it('render versions: refusals render nothing, and a failing render still restores the project', async () => {
    await runLua(`${DELIVERY}
      local function none(what, ok, err)
        assert(ok == nil and err and err:find(what, 1, true), "expected '" .. what .. "', got " .. tostring(err))
        assert(#(api.render_log or {}) == 0, "nothing rendered for: " .. what)
      end
      none("versions must be a non-empty list", project.render_versions(api, { versions = {} }, fs, resolve))
      none("'Nope' not found", project.render_versions(api, { versions = { { name = "Inst", mute = { "Nope" } } } }, fs, resolve))
      none("used twice", project.render_versions(api, { versions = { { name = "A" }, { name = "a" } } }, fs, resolve))
      none("name must be letters", project.render_versions(api, { versions = { { name = "../x" } } }, fs, resolve))
      none("would both write", project.render_versions(api, { versions = { { name = "A", filePattern = "x" }, { name = "B", filePattern = "x" } } }, fs, resolve))
      project.set_render(api, { source = "stems" })
      none("select the tracks to render first", project.render_versions(api, { versions = { { name = "A" } } }, fs, resolve))
      project.set_render(api, { source = "master" })
      fs.files["/tmp/out/song-B.wav"] = true
      none("version B: refused: /tmp/out/song-B.wav already exists", project.render_versions(api, { versions = { { name = "A" }, { name = "B" } } }, fs, resolve))
      assert(api.project.strings.RENDER_PATTERN == "song", "pattern restored after a refusal")
      fs.files["/tmp/out/song-B.wav"] = nil
      api.fail_render = true
      local ok = pcall(project.render_versions, api, { versions = { { name = "Inst", mute = { "Vocals" } } } }, fs, resolve)
      assert(not ok, "the render error surfaces")
      assert(api.GetMediaTrackInfo_Value(api.GetTrack(0, 2), "B_MUTE") == 0, "vocals unmuted after the failure")
      assert(api.project.strings.RENDER_PATTERN == "song", "pattern restored after the failure")
    `);
  });

  it('render refusals: invalid settings change nothing, nested JSON params decode', async () => {
    await runLua(`${DELIVERY}
      local before = project.get_render(api)
      local w = api.writes
      refused("unknown source 'all'", project.set_render(api, { source = "all" }))
      refused("dither must be true or false", project.set_render(api, { dither = "yes" }))
      refused("limitCeiling must be -30 to 0", project.set_render(api, { limit = true, limitCeiling = 2 }))
      refused("metadata must be an object", project.set_render(api, { metadata = "title" }))
      assert(api.writes == w, "no write")
      local after = project.get_render(api)
      assert(after.source == before.source and after.format == before.format and after.normalize == before.normalize, "settings unchanged")
      local json = load(PLAN_SRC)().json_decode
      local p = assert(project.decode_json_fields({ metadata = '{"title":"X"}', versions = '[{"name":"A","mute":["Bass"]}]', format = "wav" }, json))
      assert(p.metadata.title == "X" and p.versions[1].mute[1] == "Bass" and p.format == "wav", "decoded in place")
      local _, bad = project.decode_json_fields({ tracks = "[1," }, json)
      assert(bad and bad:find("tracks is not valid JSON"), tostring(bad))
    `);
  });
});
