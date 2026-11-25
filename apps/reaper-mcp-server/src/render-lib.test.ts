/**
 * Behaviour tests for reaper/mcp_render_lib.lua: the render cache, the multi-track render pass and
 * the focus hand-back, run in real Lua 5.4 (wasmoon) against a small fake REAPER that models what
 * matters here: a project state counter that moves on every write, solo/selection state, and a
 * render (action 42230) that writes the files the render settings name. Assertions live in the Lua
 * snippets: a failed `assert` rejects the promise.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_render_lib.lua'), 'utf8');
const factory = new LuaFactory();

const WORLD = `
lib = load(LIB_SRC, "mcp_render_lib")()
lib.reset()

-- Everything the fake REAPER holds
w = {
  tracks = {}, files = {}, renders = {}, count = 1, now = 1000, front = "com.apple.Terminal", opened = {},
  settings = { RENDER_FILE = "/out/", RENDER_PATTERN = "mix", RENDER_FORMAT = "l3pm", RENDER_FORMAT2 = "FMW ", RENDER_SETTINGS = 1,
    RENDER_BOUNDSFLAG = 2, RENDER_STARTPOS = 1, RENDER_ENDPOS = 2, RENDER_SRATE = 48000, RENDER_CHANNELS = 6,
    RENDER_NORMALIZE = 73, RENDER_DITHER = 3 },
  os_name = "OSX64", targets_listed = true, not_wav = false, writes = 0, reads = {},
}
local master = { name = "MASTER", master = true, solo = 0, selected = false }
for i, name in ipairs({ "Kick", "Snare", "Bass", "Keys" }) do
  w.tracks[i] = { name = name, guid = "{G" .. i .. "}", solo = 0, selected = false, sends = {} }
end
w.tracks[2].selected = true
w.tracks[3].solo = 1

local function bump() w.count = w.count + 1; w.writes = w.writes + 1 end

local function selected_tracks()
  local out = {}
  for i, t in ipairs(w.tracks) do if t.selected then out[#out + 1] = { i = i, t = t } end end
  return out
end

-- The files a render with the current settings writes: { path, label }
local function planned()
  local s = w.settings
  if s.RENDER_SETTINGS == 0 then return { { path = s.RENDER_FILE .. s.RENDER_PATTERN .. ".wav", label = "MASTER" } } end
  local sel = selected_tracks()
  if #sel == 1 then return { { path = s.RENDER_FILE .. s.RENDER_PATTERN .. ".wav", label = sel[1].t.name } } end
  local out = {}
  for _, e in ipairs(sel) do
    local name = s.RENDER_PATTERN:gsub("%$tracknumber", tostring(e.i))
    out[#out + 1] = { path = s.RENDER_FILE .. name .. ".wav", label = e.t.name }
  end
  return out
end

reaper = {
  GetMasterTrack = function() return master end,
  GetTrack = function(_, i) return w.tracks[i + 1] end,
  CountTracks = function() return #w.tracks end,
  GetTempPath = function() return "/tmp/" end,
  GetOS = function() return w.os_name end,
  ShowConsoleMsg = function() end,
  GetProjectStateChangeCount = function() return w.count end,
  GetTrackGUID = function(t) return t.guid or "{MASTER}" end,
  GetParentTrack = function(t) return t.parent end,
  GetTrackNumSends = function(t, cat) if cat == -1 then return t.receives or 0 end return #t.sends end,
  GetTrackSendInfo_Value = function(t, _, i, key) return t.sends[i + 1] end,
  GetSetMediaTrackInfo_String = function(t) return true, t.name end,
  GetMediaTrackInfo_Value = function(t, key)
    if key == "I_SOLO" then return t.solo end
    if key == "I_PLAY_OFFSET_FLAG" then return t.offset and 0 or 1 end
    if key == "D_PLAY_OFFSET" then return t.offset or 0 end
    if key == "B_PHASE" then return t.phase and 1 or 0 end
    if key == "I_FOLDERDEPTH" then return t.folder or 0 end
    return 0
  end,
  -- Items and the audio accessor: a track's items as the accessor hears them (dry: no FX, no pan).
  -- The fake plays a constant +0.5 on the left and -0.5 on the right, and records what was read.
  CountTrackMediaItems = function(t) return #(t.items or {}) end,
  GetTrackMediaItem = function(t, j) return t.items[j + 1] end,
  GetMediaItemInfo_Value = function(item, key) if key == "D_POSITION" then return item.pos end return item.len end,
  GetActiveTake = function(item) return item.take end,
  TakeIsMIDI = function(take) return take.midi == true end,
  TakeFX_GetCount = function(take) return #(take.fx or {}) end,
  TakeFX_GetFXName = function(take, k) return true, take.fx[k + 1] end,
  CreateTrackAudioAccessor = function(t) return { track = t, alive = true } end,
  DestroyAudioAccessor = function(acc) acc.alive = false end,
  new_array = function(n)
    local data = {}
    return { n = n, data = data, table = function(off, size)
      local out = {}
      for i = 1, size do out[i] = data[off + i - 1] or 0 end
      return out
    end }
  end,
  GetAudioAccessorSamples = function(acc, sr, ch, start, n, buf)
    assert(acc.alive and sr == 44100 and ch == 2, "an open accessor, 44100 Hz stereo")
    w.reads[#w.reads + 1] = { start = start, n = n }
    if w.accessor_fail then return -1 end
    if w.accessor_silent then return 0 end
    -- A track with items plays only inside them. An item marked leak is the one REAPER 7.40 gets
    -- wrong: a read that starts inside it and runs past its end gets its source played on to the read's end
    local items = acc.track.items or {}
    for i = 1, n do
      local t = start + (i - 1) / sr
      local on = #items == 0
      for _, it in ipairs(items) do
        if t >= it.pos and t < it.pos + it.len then on = true end
        if it.leak and t >= it.pos + it.len and start < it.pos + it.len and start + n / sr > it.pos + it.len then on = true end
      end
      buf.data[2 * i - 1] = on and 0.5 or 0
      buf.data[2 * i] = on and -0.5 or 0
    end
    return 1
  end,
  SetMediaTrackInfo_Value = function(t, key, v) if key == "I_SOLO" then t.solo = v end; bump() end,
  IsTrackSelected = function(t) return t.selected end,
  SetTrackSelected = function(t, v) t.selected = v; bump() end,
  SetOnlyTrackSelected = function(t) for _, o in ipairs(w.tracks) do o.selected = (o == t) end; bump() end,
  GetSetProjectInfo = function(_, key, v, set)
    if set then w.settings[key] = v; bump() end
    return w.settings[key] or 0
  end,
  GetSetProjectInfo_String = function(_, key, v, set)
    if set then w.settings[key] = v; bump(); return true, v end
    if key == "RENDER_TARGETS" then
      if not w.targets_listed then return true, "" end
      local paths = {}
      for _, p in ipairs(planned()) do paths[#paths + 1] = p.path end
      return true, table.concat(paths, ";")
    end
    return true, w.settings[key] or ""
  end,
  Main_OnCommand = function(id)
    assert(id == 42230, "only the render action is run")
    local solos = {}
    for i, t in ipairs(w.tracks) do solos[i] = t.solo end
    local plan = planned()
    local labels = {}
    for _, p in ipairs(plan) do
      w.files[p.path] = (w.not_wav and "ID3 " or "RIFF") .. p.label
      labels[#labels + 1] = p.label
    end
    w.renders[#w.renders + 1] = { mode = w.settings.RENDER_SETTINGS, labels = labels, solos = solos,
      format = w.settings.RENDER_FORMAT, format2 = w.settings.RENDER_FORMAT2, normalize = w.settings.RENDER_NORMALIZE,
      front_at_render = w.front }
    w.front = "com.cockos.reaper" -- the progress window takes focus
    bump()
  end,
  ExecProcess = function(cmd)
    if cmd:find("lsappinfo", 1, true) then return '0\\n"CFBundleIdentifier"="' .. w.front .. '"\\n' end
    local id = cmd:match("open %-b (%S+)")
    if id then w.opened[#w.opened + 1] = id; w.front = id end
    return "0\\n"
  end,
  EnumerateFiles = function(dir, i)
    local names = {}
    for path in pairs(w.files) do
      local name = path:match("^" .. dir:gsub("%p", "%%%0") .. "([^/]+)$")
      if name then names[#names + 1] = name end
    end
    table.sort(names)
    return names[i + 1]
  end,
}

-- The lib's file system: in memory
ENV = {
  io = { open = function(path, mode)
    if mode == "wb" then
      w.files[path] = ""
      return { write = function(self, ...) for _, s in ipairs({ ... }) do w.files[path] = w.files[path] .. s end return self end, close = function() end }
    end
    local content = w.files[path]
    if not content then return nil end
    return { read = function(_, n) return content:sub(1, n) end, seek = function() return #content end, close = function() end }
  end },
  os = { remove = function(path) w.files[path] = nil end, tmpname = function() return "/tmp/x" end, time = function() return w.now end },
  now = function() return w.now end,
}

function render(indices, extra)
  local p = { trackIndices = indices, startTime = 10, endTime = 20, commandId = "abc-123" }
  for k, v in pairs(extra or {}) do p[k] = v end
  return lib.render_tracks(reaper, p, ENV)
end
function labels_of(res)
  local out = {}
  for i, t in ipairs(res.tracks) do out[i] = w.files[t.wavPath] end
  return out
end
function count_files() local n = 0 for _ in pairs(w.files) do n = n + 1 end return n end
`;

async function runWorld(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    await lua.doString(WORLD);
    await lua.doString(snippet);
  } finally {
    lua.global.close();
  }
}

describe('render cache', () => {
  it('serves the same track and range again without rendering', async () => {
    await runWorld(`
      local a = assert(render({ 2 }))
      local b = assert(render({ 2 }))
      assert(#w.renders == 1, "rendered " .. #w.renders .. " times")
      assert(a.tracks[1].cached == false and b.tracks[1].cached == true)
      assert(a.tracks[1].wavPath == b.tracks[1].wavPath)
      assert(b.rendered == 0 and b.cached == 1)
      assert(w.files[b.tracks[1].wavPath] == "RIFFBass", "the file is the track's render")
    `);
  });

  it('renders again for another range or another track, and still has the first one afterwards', async () => {
    await runWorld(`
      assert(render({ 0 }))
      assert(render({ 1 }))
      assert(#w.renders == 2, "another track renders")
      assert(lib.render_tracks(reaper, { trackIndices = { 0 }, startTime = 10, endTime = 25 }, ENV))
      assert(#w.renders == 3, "another range renders")
      -- the render's own settings writes move REAPER's counter, which must not retire the earlier renders
      local again = assert(render({ 0 }))
      assert(#w.renders == 3 and again.tracks[1].cached, "the first render is still served")
    `);
  });

  it('renders again after a command that writes', async () => {
    await runWorld(`
      assert(render({ 2 }))
      lib.note_write()
      local b = assert(render({ 2 }))
      assert(#w.renders == 2 and b.tracks[1].cached == false)
    `);
  });

  it('renders again after the project changed under it (REAPER counts a change)', async () => {
    await runWorld(`
      assert(render({ 2 }))
      w.count = w.count + 1 -- the user edited the project
      local b = assert(render({ 2 }))
      assert(#w.renders == 2 and b.tracks[1].cached == false)
    `);
  });

  it('renders again when asked for a fresh one, or when the file is gone, or after the TTL', async () => {
    await runWorld(`
      local a = assert(render({ 2 }))
      assert(render({ 2 }, { fresh = true }))
      assert(#w.renders == 2, "fresh")
      local b = assert(render({ 2 }))
      w.files[b.tracks[1].wavPath] = nil
      assert(render({ 2 }))
      assert(#w.renders == 3, "file gone")
      w.now = w.now + lib.TTL + 1
      assert(render({ 2 }))
      assert(#w.renders == 4, "too old")
    `);
  });

  it('keeps no more than MAX_ENTRIES renders on disk and deletes the oldest', async () => {
    await runWorld(`
      lib.MAX_ENTRIES = 2
      local first = assert(render({ 0 })).tracks[1].wavPath
      assert(render({ 1 }))
      assert(render({ 2 }))
      assert(lib.cached_count() == 2)
      assert(w.files[first] == nil, "the oldest render was deleted")
      assert(count_files() == 2)
    `);
  });

  it('deletes every cached render on purge and the leftovers of an earlier run on sweep', async () => {
    await runWorld(`
      assert(render({ 0 })); assert(render({ 1 }))
      lib.purge(ENV)
      assert(count_files() == 0 and lib.cached_count() == 0)
      w.files["/tmp/mcp_aes_old.wav"] = "RIFF"
      w.files["/tmp/mcp_render_old_1.wav"] = "RIFF"
      w.files["/tmp/song.wav"] = "RIFF"
      assert(lib.sweep(reaper, ENV) == 2)
      assert(w.files["/tmp/song.wav"] and not w.files["/tmp/mcp_aes_old.wav"])
    `);
  });
});

describe('temp folder without reaper.GetTempPath', () => {
  const NO_API = `
    reaper.GetTempPath = nil
    local function env_with(tmpname, vars)
      return { io = ENV.io, now = ENV.now, os = {
        remove = ENV.os.remove, time = ENV.os.time,
        tmpname = function() return tmpname end,
        getenv = function(k) return vars[k] end } }
    end
  `;

  it('uses the folder of os.tmpname() when it has one', async () => {
    await runWorld(`${NO_API}
      w.files["/var/tmp/mcp_render_old_1.wav"] = "RIFF"
      assert(lib.sweep(reaper, env_with("/var/tmp/lua_x", {})) == 1)
    `);
  });

  it('falls back to %TEMP% when os.tmpname() is a bare Windows name', async () => {
    await runWorld(`${NO_API}
      w.files["C:/Users/x/Temp/mcp_render_old_1.wav"] = "RIFF"
      w.files["/tmp/mcp_render_old_2.wav"] = "RIFF"
      assert(lib.sweep(reaper, env_with("\\\\s3k4.", { TEMP = "C:/Users/x/Temp" })) == 1)
      assert(w.files["/tmp/mcp_render_old_2.wav"], "must not have looked in /tmp")
    `);
  });

  it('tries %TMP% when %TEMP% is unset or empty, then /tmp', async () => {
    await runWorld(`${NO_API}
      w.files["D:/scratch/mcp_render_old_1.wav"] = "RIFF"
      assert(lib.sweep(reaper, env_with("\\\\s3k4.", { TEMP = "", TMP = "D:/scratch" })) == 1)
      w.files["/tmp/mcp_render_old_2.wav"] = "RIFF"
      assert(lib.sweep(reaper, env_with("\\\\s3k4.", {})) == 1)
    `);
  });
});

describe('rendering several tracks', () => {
  it('renders unrelated tracks in one pass and gives each its own file', async () => {
    await runWorld(`
      local res = assert(render({ 0, 2, 3 }))
      assert(#w.renders == 1, "one render for three tracks, got " .. #w.renders)
      assert(w.renders[1].mode == 3, "stems of the selected tracks")
      local labels = labels_of(res)
      assert(labels[1] == "RIFFKick" and labels[2] == "RIFFBass" and labels[3] == "RIFFKeys", table.concat(labels, ","))
      assert(res.tracks[2].trackName == "Bass" and res.tracks[2].trackIndex == 2)
      assert(res.rendered == 3 and res.cached == 0)
    `);
  });

  it('renders the master apart from the tracks, in as few passes as possible', async () => {
    await runWorld(`
      local res = assert(render({ -1, 0, 1 }))
      assert(#w.renders == 2, "master + one stem pass: " .. #w.renders)
      local labels = labels_of(res)
      assert(labels[1] == "RIFFMASTER" and labels[2] == "RIFFKick" and labels[3] == "RIFFSnare", table.concat(labels, ","))
      assert(res.tracks[1].trackName == "MASTER")
    `);
  });

  it('renders tracks that feed each other separately, so one stem never carries the other', async () => {
    await runWorld(`
      w.tracks[2].parent = w.tracks[1]            -- Snare is a child of Kick's folder
      w.tracks[4].sends = { w.tracks[3] }         -- Keys sends to Bass
      local res = assert(render({ 0, 1, 2, 3 }))
      local labels = labels_of(res)
      assert(labels[1] == "RIFFKick" and labels[2] == "RIFFSnare" and labels[3] == "RIFFBass" and labels[4] == "RIFFKeys")
      for _, r in ipairs(w.renders) do
        local names = table.concat(r.labels, ",")
        assert(not (names:find("Kick") and names:find("Snare")), "folder and child together: " .. names)
        assert(not (names:find("Keys") and names:find("Bass")), "send and target together: " .. names)
      end
      assert(#w.renders == 2, "two groups of unrelated tracks, got " .. #w.renders)
    `);
  });

  it('goes track by track, without a wasted render, when REAPER does not say which file is whose', async () => {
    await runWorld(`
      w.targets_listed = false
      local res = assert(render({ 0, 2 }))
      assert(#w.renders == 2, "one render each")
      for _, r in ipairs(w.renders) do assert(#r.labels == 1) end
      local labels = labels_of(res)
      assert(labels[1] == "RIFFKick" and labels[2] == "RIFFBass")
    `);
  });

  it('serves the tracks it has and renders only the rest', async () => {
    await runWorld(`
      assert(render({ 0 }))
      local res = assert(render({ 0, 1, 2 }))
      assert(res.cached == 1 and res.rendered == 2, res.cached .. "/" .. res.rendered)
      assert(res.tracks[1].cached and not res.tracks[2].cached)
      assert(#w.renders == 2)
    `);
  });

  it('puts settings, solo and selection back, and hands the files and offset report over', async () => {
    await runWorld(`
      w.tracks[3].offset = 0.002; w.tracks[3].phase = true
      local before = {}
      for k, v in pairs(w.settings) do before[k] = v end
      local res = assert(render({ 0, 2 }))
      for k, v in pairs(before) do assert(w.settings[k] == v, k .. " restored: " .. tostring(w.settings[k])) end
      assert(w.tracks[3].solo == 1 and w.tracks[1].solo == 0, "the user's solo is back")
      assert(w.tracks[2].selected == true and w.tracks[1].selected == false, "the user's selection is back")
      assert(math.abs(res.tracks[2].playOffsetMs - 2) < 1e-9 and res.tracks[2].phaseInverted == true)
      assert(res.tracks[1].cacheOwned == true and res.tracks[1].sampleRate == 44100)
      local r = w.renders[1]
      assert(r.format == "evaw" and r.format2 == "" and r.normalize == 0, "rendered as raw WAV")
    `);
  });
});

describe('what is refused before anything is touched', () => {
  it('refuses repeats, unknown tracks, empty lists and bad ranges without rendering or writing', async () => {
    await runWorld(`
      local function refused(res, err, pattern)
        assert(res == nil and tostring(err):find(pattern), "got " .. tostring(err))
        assert(#w.renders == 0 and w.writes == 0, "something was written")
      end
      local r, e = render({ 1, 1 }); refused(r, e, "repeat")
      r, e = render({ 0, 99 }); refused(r, e, "Track 99 not found")
      r, e = render({}); refused(r, e, "trackIndices")
      r, e = lib.render_tracks(reaper, { trackIndices = { 0 }, startTime = 5, endTime = 5 }, ENV); refused(r, e, "endTime")
      r, e = render({ -2 }); refused(r, e, "Bad track index")
    `);
  });

  it('removes a file that is not a WAV and says so', async () => {
    await runWorld(`
      w.not_wav = true
      local r, e = render({ 2 })
      assert(r == nil and e:find("non-WAV", 1, true), tostring(e))
      assert(count_files() == 0 and lib.cached_count() == 0)
    `);
  });

  it('restores everything when the render itself fails', async () => {
    await runWorld(`
      reaper.Main_OnCommand = function() error("boom") end
      local r, e = render({ 2 })
      assert(r == nil and e:find("Render failed"), tostring(e))
      assert(w.settings.RENDER_PATTERN == "mix" and w.settings.RENDER_SETTINGS == 1)
      assert(w.tracks[3].solo == 1 and w.tracks[2].selected)
    `);
  });
});

describe('focus', () => {
  it('brings the app that had focus back after a render', async () => {
    await runWorld(`
      assert(render({ 2 }))
      assert(#w.opened == 1 and w.opened[1] == "com.apple.Terminal", "re-activated: " .. table.concat(w.opened, ","))
      assert(w.front == "com.apple.Terminal")
    `);
  });

  it('does nothing when REAPER already had focus, when asked not to, on another OS, or for a cached answer', async () => {
    await runWorld(`
      w.front = "com.cockos.reaper"
      assert(render({ 0 }))
      assert(#w.opened == 0, "REAPER had focus")
      w.front = "com.apple.Terminal"
      assert(render({ 1 }, { restoreFocus = false }))
      assert(#w.opened == 0, "asked not to")
      w.os_name = "Win64"
      assert(render({ 2 }))
      assert(#w.opened == 0, "not macOS")
      w.os_name = "OSX64"; w.front = "com.apple.Terminal"
      assert(render({ 2 }))
      assert(#w.opened == 0 and w.front == "com.apple.Terminal", "nothing rendered, nothing to hand back")
    `);
  });

  it('leaves someone who switched to another app during the render where they went', async () => {
    await runWorld(`
      local base = reaper.Main_OnCommand
      reaper.Main_OnCommand = function(id) base(id); w.front = "com.tinyspeck.slackmacgap" end
      assert(render({ 2 }))
      assert(#w.opened == 0 and w.front == "com.tinyspeck.slackmacgap", "not pulled back")
    `);
  });

  it('never puts an odd bundle id on a command line', async () => {
    await runWorld(`
      w.front = "evil; rm -rf ~"
      assert(render({ 2 }))
      assert(#w.opened == 0)
    `);
  });
});

// A dry read hears the track's own audio through the audio accessor: no render, so no progress window
// and no focus change. Everything that is not a plain audio track still gets a real render.
const DRY = `
function audio_on(i, pos, len)
  w.tracks[i + 1].items = { { pos = pos or 0, len = len or 100, take = { midi = false } } }
end
function dry(indices, extra)
  local p = { dry = true }
  for k, v in pairs(extra or {}) do p[k] = v end
  return render(indices, p)
end
`;

describe('dry read', () => {
  it('reads a track without rendering and hands over a 24-bit stereo WAV of the range', async () => {
    await runWorld(`${DRY}
      audio_on(0, 5, 30)
      local res = assert(dry({ 0 }))
      local t = res.tracks[1]
      assert(t.dry == true and t.cached == false and t.cacheOwned == true, "a dry read, owned by the cache")
      assert(#w.renders == 0 and res.rendered == 0 and res.dryRead == 1, "nothing was rendered")
      assert(t.durationSeconds == 10 and t.sampleRate == 44100 and t.channelCount == 2)
      local wav = w.files[t.wavPath]
      local riff, size, wave, fmt, fmtlen, tag, ch, rate, _, align, bits, data, dlen = string.unpack("<c4I4c4c4I4I2I2I4I4I2I2c4I4", wav)
      assert(riff == "RIFF" and wave == "WAVE" and fmt == "fmt " and data == "data")
      assert(tag == 1 and ch == 2 and rate == 44100 and bits == 24 and align == 6, "24-bit stereo PCM")
      assert(dlen == 10 * 44100 * 6 and #wav == 44 + dlen and size == 36 + dlen, "ten seconds, header sized to match")
      -- first frame: left +0.5, right -0.5 (within one 24-bit step)
      local left, right = string.unpack("<i3i3", wav, 45)
      assert(math.abs(left - 0.5 * 8388607) <= 1, "left is +0.5")
      assert(math.abs(right + 0.5 * 8388607) <= 1, "right is -0.5")
    `);
  });

  it('reads the range from its start, in pieces', async () => {
    await runWorld(`${DRY}
      audio_on(0, 0, 100)
      assert(dry({ 0 }))
      assert(#w.reads == 2 and w.reads[1].start == 10 and w.reads[2].start == 15, "two 5 s reads from the range start")
      local n = 0
      for _, r in ipairs(w.reads) do n = n + r.n end
      assert(n == 10 * 44100, "every sample of the range")
    `);
  });

  it('plays silence where no item is, even when the accessor plays a source on past an item\'s end', async () => {
    await runWorld(`${DRY}
      w.tracks[1].items = { { pos = 12, len = 2, leak = true, take = { midi = false } } }
      local res = assert(dry({ 0 }))
      local wav = w.files[res.tracks[1].wavPath]
      local function left(t) return (string.unpack("<i3", wav, 45 + math.floor((t - 10) * 44100) * 6)) end
      assert(left(11) == 0, "silent before the item")
      assert(left(13) > 4000000, "audible inside it")
      assert(left(13.99) > 4000000, "audible up to its last moment")
      assert(left(14.01) == 0, "silent from its end")
      assert(left(14.9) == 0, "silent where the source played on")
    `);
  });

  it('renders a range that holds a junction, where one item ends and another plays on after it', async () => {
    await runWorld(`${DRY}
      w.tracks[1].items = {
        { pos = 11, len = 4.5, take = { midi = false } },
        { pos = 15.5, len = 6, take = { midi = false } },
      }
      -- the first item ends at 15.5 inside 10..20, and the second plays on from it
      local res = assert(dry({ 0 }))
      assert(res.tracks[1].dry == false and #w.renders == 1 and #w.reads == 0)
      -- overlapping items are a junction too
      w.tracks[1].items = {
        { pos = 11, len = 6, take = { midi = false } },
        { pos = 15, len = 6, take = { midi = false } },
      }
      local overlap = assert(dry({ 0 }, { fresh = true }))
      assert(overlap.tracks[1].dry == false and #w.reads == 0)
    `);
  });

  it('renders an item with a third-party take FX, which the accessor can return as silence, and reads REAPER-native ones', async () => {
    await runWorld(`${DRY}
      w.tracks[1].items = { { pos = 11, len = 8, take = { midi = false, fx = { "VST3: Melodyne (Celemony)" } } } }
      local res = assert(dry({ 0 }))
      assert(res.tracks[1].dry == false and #w.renders == 1 and #w.reads == 0)
      w.tracks[1].items = { { pos = 11, len = 8, take = { midi = false, fx = { "VST: ReaEQ (Cockos)", "JS: Volume Adjustment" } } } }
      local native = assert(dry({ 0 }, { fresh = true }))
      assert(native.tracks[1].dry == true)
    `);
  });

  it('renders a track that receives audio by send, which its own items do not hold', async () => {
    await runWorld(`${DRY}
      w.tracks[1].items = { { pos = 11, len = 8, take = { midi = false } } }
      w.tracks[1].receives = 1
      local res = assert(dry({ 0 }))
      assert(res.tracks[1].dry == false and #w.renders == 1 and #w.reads == 0)
    `);
  });

  it('reads a range that starts after the junction, or ends before it', async () => {
    await runWorld(`${DRY}
      w.tracks[1].items = {
        { pos = 0, len = 15.5, take = { midi = false } },
        { pos = 15.5, len = 40, take = { midi = false } },
      }
      local after = assert(dry({ 0 }, { startTime = 16, endTime = 24 }))
      assert(after.tracks[1].dry == true, "starts half a second after the junction")
      local before = assert(dry({ 0 }, { startTime = 8, endTime = 15 }))
      assert(before.tracks[1].dry == true, "ends before the first item does")
    `);
  });

  it('reads an item whose neighbour is further off than a read reaches, and silences what follows its end', async () => {
    await runWorld(`${DRY}
      w.tracks[1].items = {
        { pos = 11, len = 2, leak = true, take = { midi = false } },
        { pos = 30, len = 5, take = { midi = false } },
      }
      local res = assert(dry({ 0 }, { startTime = 10, endTime = 20 }))
      assert(res.tracks[1].dry == true)
      local wav = w.files[res.tracks[1].wavPath]
      local function left(t) return (string.unpack("<i3", wav, 45 + math.floor((t - 10) * 44100) * 6)) end
      assert(left(10.5) == 0 and left(12) > 4000000, "audible inside the item")
      assert(left(13.5) == 0 and left(14.9) == 0, "silent after its end, where the accessor played the source on")
    `);
  });

  it('plays a track whose polarity is switched inverted, as a render does', async () => {
    await runWorld(`${DRY}
      audio_on(0, 0, 100); w.tracks[1].phase = true
      local res = assert(dry({ 0 }))
      local left, right = string.unpack("<i3i3", w.files[res.tracks[1].wavPath], 45)
      assert(math.abs(left + 0.5 * 8388607) <= 1 and math.abs(right - 0.5 * 8388607) <= 1, "both channels flipped")
    `);
  });

  it('plays a track later by its playback offset, as a render does', async () => {
    await runWorld(`${DRY}
      w.tracks[1].items = { { pos = 12, len = 3, take = { midi = false } } }
      w.tracks[1].offset = 2
      local res = assert(dry({ 0 }))
      local wav = w.files[res.tracks[1].wavPath]
      local function left(t) return (string.unpack("<i3", wav, 45 + math.floor((t - 10) * 44100) * 6)) end
      assert(left(13) == 0, "the item's own place is silent now")
      assert(left(15) > 4000000 and left(16.9) > 4000000, "audible two seconds later")
      assert(left(17.1) == 0)
      assert(w.reads[1].start == 8, "the accessor is asked for the audio that lands here")
    `);
  });

  it('renders when the offset would ask the accessor for audio before the project starts', async () => {
    await runWorld(`${DRY}
      audio_on(0, 0, 100); w.tracks[1].offset = 11
      local res = assert(dry({ 0 }))
      assert(res.tracks[1].dry == false and #w.renders == 1 and #w.reads == 0)
    `);
  });

  it('leaves render settings, solo and selection exactly as they were', async () => {
    await runWorld(`${DRY}
      audio_on(0, 0, 100)
      local before = {}
      for k, v in pairs(w.settings) do before[k] = v end
      local writes = w.writes
      assert(dry({ 0 }))
      for k, v in pairs(before) do assert(w.settings[k] == v, k .. " changed") end
      assert(w.writes == writes, "the project was not written to")
      assert(w.tracks[3].solo == 1 and w.tracks[2].selected == true and w.tracks[1].selected == false)
      assert(w.front == "com.apple.Terminal" and #w.opened == 0, "focus never moved")
    `);
  });

  it('serves the same read again from the cache until something changes', async () => {
    await runWorld(`${DRY}
      audio_on(0, 0, 100)
      local a = assert(dry({ 0 }))
      local b = assert(dry({ 0 }))
      assert(#w.reads == 2 and b.tracks[1].cached == true and b.tracks[1].dry == true, "second call read nothing")
      assert(a.tracks[1].wavPath == b.tracks[1].wavPath and b.dryRead == 0 and b.cached == 1)
      lib.note_write()
      local c = assert(dry({ 0 }))
      assert(c.tracks[1].cached == false and #w.reads == 4, "a write retires it")
    `);
  });

  it('does not hand a render out as a dry read, or the other way round', async () => {
    await runWorld(`${DRY}
      audio_on(0, 0, 100)
      local rendered = assert(render({ 0 }))
      local read = assert(dry({ 0 }))
      assert(rendered.tracks[1].dry == false and read.tracks[1].dry == true)
      assert(rendered.tracks[1].wavPath ~= read.tracks[1].wavPath and #w.renders == 1 and #w.reads == 2)
      local again = assert(render({ 0 }))
      assert(again.tracks[1].cached == true and again.tracks[1].dry == false, "the render is still its own")
    `);
  });

  it('renders as before when a dry read is not asked for', async () => {
    await runWorld(`${DRY}
      audio_on(0, 0, 100)
      local res = assert(render({ 0 }))
      assert(res.tracks[1].dry == false and #w.renders == 1 and #w.reads == 0)
    `);
  });

  it('renders the master, which has no items of its own', async () => {
    await runWorld(`${DRY}
      local res = assert(dry({ -1 }))
      assert(res.tracks[1].dry == false and #w.renders == 1 and #w.reads == 0)
    `);
  });

  it('renders a folder parent, whose sound is its children', async () => {
    await runWorld(`${DRY}
      audio_on(0, 0, 100); w.tracks[1].folder = 1
      local res = assert(dry({ 0 }))
      assert(res.tracks[1].dry == false and #w.renders == 1 and #w.reads == 0)
    `);
  });

  it('renders a track that plays MIDI, whose sound is its instrument', async () => {
    await runWorld(`${DRY}
      w.tracks[1].items = { { pos = 0, len = 100, take = { midi = true } } }
      local res = assert(dry({ 0 }))
      assert(res.tracks[1].dry == false and #w.renders == 1 and #w.reads == 0)
    `);
  });

  it('renders a track with no audio in the range, which a dry read would report as silence', async () => {
    await runWorld(`${DRY}
      audio_on(0, 100, 50) -- starts after the range ends
      local res = assert(dry({ 0 }))
      assert(res.tracks[1].dry == false and #w.renders == 1 and #w.reads == 0)
    `);
  });

  it('renders a range too long to read in one go', async () => {
    await runWorld(`${DRY}
      audio_on(0, 0, 1000)
      local res = assert(dry({ 0 }, { startTime = 0, endTime = 200 }))
      assert(res.tracks[1].dry == false and #w.renders == 1 and #w.reads == 0)
      local ok = assert(dry({ 0 }, { startTime = 0, endTime = 120 }))
      assert(ok.tracks[1].dry == true, "120 s is the limit")
    `);
  });

  it('renders the track after all when the accessor fails, and leaves no half-written file', async () => {
    await runWorld(`${DRY}
      audio_on(0, 0, 100)
      w.accessor_fail = true
      local res = assert(dry({ 0 }))
      assert(res.tracks[1].dry == false and #w.renders == 1, "rendered instead")
      assert(w.files[res.tracks[1].wavPath] == "RIFFKick", "the file is the render")
      assert(count_files() == 1, "the failed read left nothing behind")
    `);
  });

  it('treats a stretch the accessor has no audio for as silence', async () => {
    await runWorld(`${DRY}
      audio_on(0, 0, 100)
      w.accessor_silent = true
      local res = assert(dry({ 0 }))
      local wav = w.files[res.tracks[1].wavPath]
      assert(res.tracks[1].dry == true and #wav == 44 + 10 * 44100 * 6)
      assert(wav:sub(45, 200) == string.rep("\\0", 156), "zeros")
    `);
  });

  it('reads what it can and renders the rest in one call, answering in the order asked', async () => {
    await runWorld(`${DRY}
      audio_on(0, 0, 100)             -- Kick: audio
      local res = assert(dry({ 1, 0 })) -- Snare has no items: rendered
      assert(res.tracks[1].trackName == "Snare" and res.tracks[1].dry == false)
      assert(res.tracks[2].trackName == "Kick" and res.tracks[2].dry == true)
      assert(#w.renders == 1 and #w.renders[1].labels == 1 and w.renders[1].labels[1] == "Snare", "only Snare was rendered")
      assert(res.rendered == 1 and res.dryRead == 1)
    `);
  });
});
