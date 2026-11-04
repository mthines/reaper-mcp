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
  os_name = "OSX64", targets_listed = true, not_wav = false, writes = 0,
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
  GetTrackNumSends = function(t) return #t.sends end,
  GetTrackSendInfo_Value = function(t, _, i, key) return t.sends[i + 1] end,
  GetSetMediaTrackInfo_String = function(t) return true, t.name end,
  GetMediaTrackInfo_Value = function(t, key)
    if key == "I_SOLO" then return t.solo end
    if key == "I_PLAY_OFFSET_FLAG" then return t.offset and 0 or 1 end
    if key == "D_PLAY_OFFSET" then return t.offset or 0 end
    if key == "B_PHASE" then return t.phase and 1 or 0 end
    return 0
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
  io = { open = function(path)
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
