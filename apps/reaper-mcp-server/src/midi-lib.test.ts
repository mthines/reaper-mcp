/**
 * Behaviour of reaper/mcp_midi_lib.lua (quantize, transform, MIDI file import, pitch
 * profile), run in real Lua 5.4 (wasmoon) against the fake MIDI API
 * (__fixtures__/fake_midi.lua). Assertions live in the Lua snippets: a failed
 * `assert` rejects the promise.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_midi_lib.lua'), 'utf8');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_midi.lua'), 'utf8');

const factory = new LuaFactory();

// One track "Keys" with one 8-beat item at 2 s (= beat 4 on the project grid)
const KEYS = `
function keys(notes, extra)
  local items = { { pos = 2, len = 4, notes = notes } }
  for _, it in ipairs(extra or {}) do items[#items + 1] = it end
  return new_midi_fake{ tracks = { { name = "Keys", items = items } } }
end
function refused(api, pattern, r, err)
  assert(r == nil, "expected a refusal")
  assert(err:find(pattern), "error: " .. tostring(err))
  assert(err:find("nothing changed"), "says nothing changed: " .. err)
  assert(api.writes == 0, "a refusal writes nothing")
end
`;

async function runLua(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    await lua.doString(FAKE_SRC);
    await lua.doString(`midi = load(LIB_SRC, "mcp_midi_lib.lua")()\n${KEYS}\n${snippet}`);
  } finally {
    lua.global.close();
  }
}

describe('mcp_midi_lib.lua quantize', () => {
  it('snaps note starts to the grid and keeps their lengths, in one undo point', async () => {
    await runLua(`
      local api = keys({ { s = 0.1, e = 0.6, pitch = 60 }, { s = 1.45, e = 1.7, pitch = 62 }, { s = 2, e = 3, pitch = 64 } })
      local r, err = midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 0.5 })
      assert(r, tostring(err))
      assert(api.notes_of(0, 0) == "60@0-0.5:100 62@1.5-1.75:100 64@2-3:100", api.notes_of(0, 0))
      assert(r.notes == 3 and r.moved == 2, "the note already on the grid does not count as moved")
      assert(r.maxShiftBeats == 0.1, "largest shift " .. r.maxShiftBeats)
      assert(#api.undo == 1 and api.undo[1] == "MCP: Quantize MIDI")
    `);
  });

  it('snaps to the project grid, not to the item start', async () => {
    await runLua(`
      -- An item at 0.25 s starts at beat 0.5: its note at item beat 0 sits on project beat 0.5
      local api = new_midi_fake{ tracks = { { items = { { pos = 0.25, len = 2, notes = { { s = 0.1, e = 0.4, pitch = 60 } } } } } } }
      midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 1 })
      -- project beat 0.6 → 1.0, which is item beat 0.5
      assert(api.notes_of(0, 0) == "60@0.5-0.8:100", api.notes_of(0, 0))
    `);
  });

  it('moves part of the way at a strength below 1, and pushes off-beats later with swing', async () => {
    await runLua(`
      local api = keys({ { s = 0.2, e = 0.4, pitch = 60 }, { s = 0.6, e = 0.7, pitch = 62 } })
      midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 0.5, strength = 0.5, swing = 0.5 })
      -- 0.2 → half way to 0; 0.6 → half way to the swung off-beat at 0.75
      assert(api.notes_of(0, 0) == "60@0.1-0.3:100 62@0.675-0.775:100", api.notes_of(0, 0))
    `);
  });

  it('leaves notes outside the window alone and can quantize note ends too', async () => {
    await runLua(`
      local api = keys({ { s = 0.05, e = 0.9, pitch = 60 }, { s = 0.25, e = 0.4, pitch = 62 } })
      local r = midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 1, window = 0.2, lengths = "quantize" })
      assert(r.moved == 1, "only the note within 0.1 beat of a line moves")
      assert(api.notes_of(0, 0) == "60@0-1:100 62@0.25-0.4:100", api.notes_of(0, 0))
    `);
  });

  it('a quantize that fails half way through its notes is undone', async () => {
    await runLua(`
      local api = keys({ { s = 0.1, e = 0.6, pitch = 60 }, { s = 1.1, e = 1.6, pitch = 62 }, { s = 2.1, e = 3, pitch = 64 } })
      local before = api.notes_of(0, 0)
      api.fail_setnote_at = 2
      local r, err = midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 1 })
      assert(r == nil and err:find("undone"), tostring(err))
      assert(api.notes_of(0, 0) == before and #api.undo == 0, api.notes_of(0, 0))
    `);
  });

  it('gives each of two edits in a row its own undo point', async () => {
    await runLua(`
      local api = keys({ { s = 0.1, e = 0.5, pitch = 60 } })
      midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 1 })
      midi.transform(api, { trackIndex = 0, itemIndex = 0, transpose = 2 })
      assert(#api.undo == 2 and api.undo[1] == "MCP: Quantize MIDI" and api.undo[2] == "MCP: Transform MIDI", table.concat(api.undo, ","))
    `);
  });

  it('reaches every note at window 1 even with swing, the swung off-beat included', async () => {
    await runLua(`
      -- 8ths with swing 0.5: lines at 0, 0.75, 1, 1.75 … — a note at 0.37 is 0.37 from 0 and 0.38 from 0.75
      local api = keys({ { s = 0.37, e = 0.45, pitch = 60 } })
      local r = midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 0.5, swing = 0.5 })
      assert(r.moved == 1 and api.notes_of(0, 0) == "60@0-0.08:100", api.notes_of(0, 0))
    `);
  });

  it('with swing, a note near an off-grid item start moves to the next swung line, not between lines', async () => {
    await runLua(`
      -- 8ths swung 0.5 put lines at 0, 0.75, 1, 1.75 …; the item starts at beat 0.8 (0.4 s), so its note on
      -- beat 0.8 is nearest 0.75, before the item: the next line is 1, not 0.75 + one step (1.25)
      local api = new_midi_fake{ tracks = { { items = { { pos = 0.4, len = 2, notes = { { s = 0, e = 0.1, pitch = 60 } } } } } } }
      midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 0.5, swing = 0.5 })
      assert(api.notes_of(0, 0) == "60@0.2-0.3:100", api.notes_of(0, 0))
    `);
  });

  it('snaps the end of a note whose start is already on the grid', async () => {
    await runLua(`
      local api = keys({ { s = 0, e = 0.9, pitch = 60 } })
      local r = midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 1, lengths = "quantize" })
      assert(r.moved == 1 and api.notes_of(0, 0) == "60@0-1:100", api.notes_of(0, 0))
    `);
  });

  it('never moves a note before the item start', async () => {
    await runLua(`
      -- The item starts at beat 0.4. A note on its start is nearest beat 0, outside the item: it stays.
      -- A note at beat 0.6 is also nearest beat 0 (0.4 from beat 1 is no closer): beat 1 is the first line inside
      local api = new_midi_fake{ tracks = { { items = { { pos = 0.2, len = 2, notes = {
        { s = 0, e = 0.5, pitch = 60 }, { s = 0.2, e = 0.4, pitch = 62 } } } } } } }
      midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 1 })
      assert(api.notes_of(0, 0) == "60@0-0.5:100 62@0.6-0.8:100", api.notes_of(0, 0))
    `);
  });

  it('quantizes only the chosen notes: by index, by pitch range, by channel', async () => {
    await runLua(`
      local api = keys({ { s = 0.1, e = 0.5, pitch = 36, chan = 9 }, { s = 0.1, e = 0.5, pitch = 60 }, { s = 1.1, e = 1.5, pitch = 72 } })
      midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 1, notes = { 2 } })
      assert(api.notes_of(0, 0) == "36@0.1-0.5:100 60@0.1-0.5:100 72@1-1.4:100", api.notes_of(0, 0))
      midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 1, channel = 9 })
      assert(api.notes_of(0, 0) == "36@0-0.4:100 60@0.1-0.5:100 72@1-1.4:100", api.notes_of(0, 0))
      midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 1, pitchMin = 50, pitchMax = 70 })
      assert(api.notes_of(0, 0) == "36@0-0.4:100 60@0-0.4:100 72@1-1.4:100", api.notes_of(0, 0))
    `);
  });

  it('refuses a bad grid, an audio item, an unknown note or an empty selection and changes nothing', async () => {
    await runLua(`
      local api = keys({ { s = 0.1, e = 0.5, pitch = 60 } }, { { pos = 8, len = 2, audio = true } })
      refused(api, "grid", midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 0 }))
      refused(api, "not a MIDI item", midi.quantize(api, { trackIndex = 0, itemIndex = 1, grid = 1 }))
      refused(api, "note 5 not found", midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 1, notes = { 5 } }))
      refused(api, "no notes match", midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 1, pitchMin = 80 }))
      refused(api, "swing", midi.quantize(api, { trackIndex = 0, itemIndex = 0, grid = 1, swing = 1 }))
      refused(api, "track 3 not found", midi.quantize(api, { trackIndex = 3, itemIndex = 0, grid = 1 }))
      assert(#api.undo == 0)
    `);
  });
});

describe('mcp_midi_lib.lua transform', () => {
  it('transposes and scales velocity, clamped to the given range', async () => {
    await runLua(`
      local api = keys({ { s = 0, e = 1, pitch = 60, vel = 100 }, { s = 1, e = 2, pitch = 64, vel = 40 } })
      local r, err = midi.transform(api, { trackIndex = 0, itemIndex = 0, transpose = 7,
        velocity = { scale = 1.5, max = 120 } })
      assert(r, tostring(err))
      assert(api.notes_of(0, 0) == "67@0-1:120 71@1-2:60", api.notes_of(0, 0))
      assert(r.velocityClamped == 1 and r.avgVelocityBefore == 70 and r.avgVelocityAfter == 90)
      assert(api.undo[1] == "MCP: Transform MIDI")
    `);
  });

  it('refuses a transpose that would push any note out of 0-127 and changes nothing', async () => {
    await runLua(`
      local api = keys({ { s = 0, e = 1, pitch = 120 }, { s = 1, e = 2, pitch = 60 } })
      refused(api, "1 note%(s%) would leave", midi.transform(api, { trackIndex = 0, itemIndex = 0, transpose = 12 }))
      refused(api, "at least one of", midi.transform(api, { trackIndex = 0, itemIndex = 0 }))
      refused(api, "velocity.set", midi.transform(api, { trackIndex = 0, itemIndex = 0, velocity = { set = 0 } }))
      refused(api, "length.scale", midi.transform(api, { trackIndex = 0, itemIndex = 0, length = { scale = 0 } }))
    `);
  });

  it('humanizes the same way for the same seed and reports it', async () => {
    await runLua(`
      local function run(seed)
        local api = keys({ { s = 1, e = 2, pitch = 60, vel = 90 }, { s = 2, e = 3, pitch = 62, vel = 90 } })
        local r = midi.transform(api, { trackIndex = 0, itemIndex = 0, humanize = { timingBeats = 0.05, velocity = 10, seed = seed } })
        return api.notes_of(0, 0), r
      end
      local a, ra = run(7)
      local b = run(7)
      local c = run(8)
      assert(a == b, "same seed, same result")
      assert(a ~= c, "another seed differs")
      assert(ra.seed == 7)
      assert(a ~= "60@1-2:90 62@2-3:90", "notes moved: " .. a)
      for s, vel in a:gmatch("@([%d.]+)%-[%d.]+:(%d+)") do
        assert(tonumber(vel) >= 80 and tonumber(vel) <= 100, "velocity within ±10: " .. vel)
      end
    `);
  });

  it('makes humanized notes legato to where the next note ends up, never overlapping', async () => {
    await runLua(`
      local api = keys({ { s = 0, e = 0.5, pitch = 60 }, { s = 1, e = 1.5, pitch = 62 }, { s = 2, e = 2.5, pitch = 64 } })
      midi.transform(api, { trackIndex = 0, itemIndex = 0, length = { legato = true }, humanize = { timingBeats = 0.25, seed = 7 } })
      local notes = api.tracks[1].items[1].take.notes
      for k = 1, #notes - 1 do
        assert(math.abs(notes[k].e - notes[k + 1].s) < 1e-6, "note " .. k .. " ends where the next starts: " .. api.notes_of(0, 0))
      end
    `);
  });

  it('sets lengths and makes notes legato on the same channel', async () => {
    await runLua(`
      local api = keys({ { s = 0, e = 0.25, pitch = 60 }, { s = 1, e = 1.25, pitch = 62 }, { s = 3, e = 3.5, pitch = 64 } })
      midi.transform(api, { trackIndex = 0, itemIndex = 0, length = { legato = true } })
      assert(api.notes_of(0, 0) == "60@0-1:100 62@1-3:100 64@3-3.5:100", "the last note keeps its length: " .. api.notes_of(0, 0))
      midi.transform(api, { trackIndex = 0, itemIndex = 0, notes = { 2 }, length = { set = 2 } })
      assert(api.notes_of(0, 0) == "60@0-1:100 62@1-3:100 64@3-5:100", api.notes_of(0, 0))
    `);
  });
});

describe('mcp_midi_lib.lua import', () => {
  it('merges every file track into one named item on the target track', async () => {
    await runLua(`
      local api = new_midi_fake{ tracks = { { name = "Piano" } } }
      local r, err = midi.import(api, { trackIndex = 0, position = 4, lengthQN = 8, name = "song.mid", tracks = {
        { name = "RH", notes = { { 0, 1, 0, 72, 90 } }, cc = { { 0, 0, 64, 127 } } },
        { name = "LH", notes = { { 0, 2, 0, 48, 80 }, { 2, 2, 0, 50, 80 } } } } })
      assert(r, tostring(err))
      assert(#r.items == 1 and r.items[1].notes == 3 and r.items[1].cc == 1 and r.items[1].itemIndex == 0)
      local item = api.tracks[1].items[1]
      assert(item.pos == 4 and item.len == 4, "8 beats at 120 BPM from 4 s")
      assert(item.take.name == "song.mid")
      assert(api.notes_of(0, 0) == "48@0-2:80 72@0-1:90 50@2-4:80", api.notes_of(0, 0))
      assert(item.take.cc[1].cc == 64 and item.take.cc[1].value == 127)
      assert(#api.undo == 1 and api.undo[1] == "MCP: Import MIDI file")
    `);
  });

  it('puts each file track on a new named track when asked', async () => {
    await runLua(`
      local api = new_midi_fake{ tracks = { { name = "A" }, { name = "B" } } }
      local r = midi.import(api, { trackIndex = 1, newTracks = true, position = 0, lengthQN = 4, tracks = {
        { name = "Bass", notes = { { 0, 1, 0, 36, 100 } } }, { name = "Lead", notes = { { 1, 1, 0, 76, 100 } } } } })
      assert(#api.tracks == 4)
      assert(api.tracks[2].name == "Bass" and api.tracks[3].name == "Lead" and api.tracks[4].name == "B")
      assert(r.items[2].trackIndex == 2 and api.notes_of(2, 0) == "76@1-2:100")
    `);
  });

  it('an import that fails half way leaves no new tracks behind', async () => {
    await runLua(`
      local api = new_midi_fake{ tracks = { { name = "A" }, { name = "B" } } }
      api.fail_create_at = 2
      local r, err = midi.import(api, { trackIndex = 1, newTracks = true, position = 0, lengthQN = 4, tracks = {
        { name = "Bass", notes = { { 0, 1, 0, 36, 100 } } }, { name = "Lead", notes = { { 1, 1, 0, 76, 100 } } } } })
      assert(r == nil and err:find("undone"), tostring(err))
      assert(#api.tracks == 2 and api.tracks[1].name == "A" and api.tracks[2].name == "B", #api.tracks .. " tracks")
      assert(#api.undo == 0)
    `);
  });

  it('a failed import that wrote nothing keeps the last import of the same tool', async () => {
    await runLua(`
      local api = new_midi_fake{ tracks = { { name = "A" } } }
      local file = { trackIndex = 0, position = 0, lengthQN = 4, tracks = { { name = "T", notes = { { 0, 1, 0, 60, 100 } } } } }
      assert(midi.import(api, file))
      api.fail_create_at = 2
      local r, err = midi.import(api, file)
      assert(r == nil and not err:find("undone"), tostring(err))
      assert(#api.tracks[1].items == 1 and #api.undo == 1 and api.undo[1] == "MCP: Import MIDI file")
    `);
  });

  it('merges a file with more tracks than may become new tracks', async () => {
    await runLua(`
      local api = new_midi_fake{ tracks = { { name = "A" } } }
      local tracks = {}
      for i = 1, midi.MAX_IMPORT_TRACKS + 1 do tracks[i] = { name = "T" .. i, notes = { { 0, 1, 0, 60, 100 } } } end
      local r, err = midi.import(api, { trackIndex = 0, position = 0, lengthQN = 4, tracks = tracks })
      assert(r and r.items[1].notes == midi.MAX_IMPORT_TRACKS + 1, tostring(err))
      api.writes = 0
      refused(api, "at most", midi.import(api, { trackIndex = 0, newTracks = true, position = 0, lengthQN = 4, tracks = tracks }))
    `);
  });

  it('refuses a malformed note, too many notes or a missing track and changes nothing', async () => {
    await runLua(`
      local api = new_midi_fake{ tracks = { { name = "A" } } }
      refused(api, "malformed note", midi.import(api, { trackIndex = 0, position = 0, lengthQN = 4, tracks = { { notes = { { 0, 1, 0, 128, 100 } } } } }))
      refused(api, "track 4 not found", midi.import(api, { trackIndex = 4, position = 0, lengthQN = 4, tracks = { { notes = { { 0, 1, 0, 60, 100 } } } } }))
      refused(api, "no notes", midi.import(api, { trackIndex = 0, position = 0, lengthQN = 4, tracks = {} }))
      local many = {}
      for i = 1, midi.MAX_IMPORT_NOTES + 1 do many[i] = { 0, 1, 0, 60, 100 } end
      refused(api, "at most", midi.import(api, { trackIndex = 0, position = 0, lengthQN = 4, tracks = { { notes = many } } }))
    `);
  });
});

describe('mcp_midi_lib.lua pitch_profile', () => {
  it('weighs pitch classes by duration and velocity, skipping drums, muted notes and muted items', async () => {
    await runLua(`
      local api = new_midi_fake{ tracks = { { items = {
        { pos = 0, len = 4, notes = { { s = 0, e = 2, pitch = 60, vel = 127 }, { s = 0, e = 1, pitch = 67, vel = 127 },
          { s = 0, e = 4, pitch = 36, vel = 127, chan = 9 }, { s = 0, e = 4, pitch = 61, vel = 127, muted = true } } },
        { pos = 4, len = 2, mute = true, notes = { { s = 0, e = 4, pitch = 62, vel = 127 } } },
        { pos = 6, len = 2, audio = true } } } } }
      local r = midi.pitch_profile(api, { trackIndex = 0 })
      assert(r.chroma[1] == 2 and r.chroma[8] == 1, "C 2 beats, G 1 beat")
      assert(r.chroma[2] == 0 and r.chroma[3] == 0, "muted note and muted item ignored")
      assert(r.notes == 2 and r.midiItems == 1 and r.audioItems == 1)
      local window = midi.pitch_profile(api, { trackIndex = 0, startTime = 0.25, endTime = 0.75 })
      assert(window.chroma[1] == 1 and window.chroma[8] == 0.5, "clipped to the time window")
      -- Trim the item to its first beat: the rest of the C and the G past it are not heard
      api.tracks[1].items[1].len = 0.5
      local trimmed = midi.pitch_profile(api, { trackIndex = 0 })
      assert(trimmed.chroma[1] == 1 and trimmed.chroma[8] == 1, "clipped to the item: " .. table.concat(trimmed.chroma, ","))
    `);
  });

  it('reads a late range on a track with more items than the cap, and counts what the cap left out', async () => {
    await runLua(`
      midi.MAX_PROFILE_ITEMS = 2
      local items = {}
      for k = 0, 5 do items[#items + 1] = { pos = k, len = 1, notes = { { s = 0, e = 2, pitch = 60 + k, vel = 127 } } } end
      local api = new_midi_fake{ tracks = { { items = items } } }
      local late = midi.pitch_profile(api, { trackIndex = 0, startTime = 5, endTime = 6 })
      assert(late.notes == 1 and late.chroma[6] == 2 and late.itemsNotRead == nil, "item at 5 s read: " .. table.concat(late.chroma, ","))
      local all = midi.pitch_profile(api, { trackIndex = 0 })
      assert(all.notes == 2 and all.itemsNotRead == 4, tostring(all.itemsNotRead))
    `);
  });
});

describe('mcp_midi_lib.lua chord_grid', () => {
  // 120 BPM 4/4 in the fake: a bar is 2 s, a beat 0.5 s
  it('splits the range into bars with each bar\'s notes and its lowest held note', async () => {
    await runLua(`
      local api = new_midi_fake{ tracks = { { items = {
        { pos = 0, len = 4, notes = {
          { s = 0, e = 4, pitch = 57, vel = 127 }, { s = 0, e = 4, pitch = 60, vel = 127 }, { s = 0, e = 4, pitch = 64, vel = 127 },
          { s = 0, e = 4, pitch = 45, vel = 127 },
          { s = 4, e = 8, pitch = 53, vel = 127 }, { s = 4, e = 8, pitch = 57, vel = 127 }, { s = 4, e = 8, pitch = 60, vel = 127 },
          { s = 0, e = 8, pitch = 36, vel = 127, chan = 9 },
          { s = 7.9, e = 8, pitch = 30, vel = 127 } } } } } } }
      local r = midi.chord_grid(api, { trackIndex = 0, per = "bar", midi = true })
      assert(r.startTime == 0 and r.endTime == 4, "range ends where the last item ends")
      assert(#r.segments == 2, "two bars: " .. #r.segments)
      assert(r.segments[2].start == 2 and r.segments[2]["end"] == 4 and r.segments[2].bar == 2 and r.segments[2].beat == 1)
      local am, f = r.profiles[1], r.profiles[2]
      assert(am[10] == 8 and am[1] == 4 and am[5] == 4 and am[6] == 0, "bar 1: A (two octaves), C, E, 4 beats each: " .. table.concat(am, ","))
      assert(f[6] == 4 and f[10] == 4 and f[1] == 4 and f[5] == 0, "bar 2: F, A, C: " .. table.concat(f, ","))
      assert(r.bass[1] == 45, "bar 1 bass: the held A2, not the drum")
      assert(r.bass[2] == 53, "bar 2 bass: F3; the short F#1 at the end does not count")
      assert(r.notes == 8)
    `);
  });

  it('gives one segment per beat, clipped to the range, numbered within the bar', async () => {
    await runLua(`
      local api = new_midi_fake{ tracks = { { items = { { pos = 0, len = 8, notes = {} } } } } }
      local r = midi.chord_grid(api, { trackIndex = 0, per = "beat", startTime = 1.25, endTime = 3 })
      assert(#r.segments == 4, "beats: " .. #r.segments)
      local first, last = r.segments[1], r.segments[4]
      assert(first.start == 1.25 and first["end"] == 1.5 and first.bar == 1 and first.beat == 3, "first beat clipped to the start")
      assert(last.start == 2.5 and last["end"] == 3 and last.bar == 2 and last.beat == 2)
      assert(r.profiles == nil, "no MIDI profiles unless asked")
    `);
  });

  it('follows the time signature: three beats a bar in 3/4', async () => {
    await runLua(`
      local api = new_midi_fake{ beatsPerBar = 3, tracks = { { items = { { pos = 0, len = 3, notes = {} } } } } }
      local r = midi.chord_grid(api, { trackIndex = 0, per = "bar" })
      assert(#r.segments == 2 and r.segments[1]["end"] == 1.5, "bars of 1.5 s")
    `);
  });

  it("reads one item's range, and the master up to the project end", async () => {
    await runLua(`
      local api = new_midi_fake{ projectLength = 6, tracks = { { items = { { pos = 0, len = 2, notes = {} }, { pos = 4, len = 4, notes = {} } } } } }
      local r = midi.chord_grid(api, { trackIndex = 0, itemIndex = 1 })
      assert(r.startTime == 4 and r.endTime == 8 and #r.segments == 2)
      local range = midi.item_range(api, { trackIndex = 0, itemIndex = 1 })
      assert(range.startTime == 4 and range.endTime == 8)
      local m = midi.chord_grid(api, { trackIndex = -1 })
      assert(m.endTime == 6 and #m.segments == 3, "master: to the project end")
    `);
  });

  it('refuses what it cannot read, saying why', async () => {
    await runLua(`
      local api = new_midi_fake{ tracks = { { items = { { pos = 0, len = 2, notes = {} } } } } }
      local function no(p, pattern)
        local r, err = midi.chord_grid(api, p)
        assert(r == nil and err:find(pattern), tostring(err))
      end
      no({ trackIndex = 3 }, "track 3 not found")
      no({ trackIndex = 0, itemIndex = 5 }, "item 5 not found")
      no({ trackIndex = -1, itemIndex = 0 }, "master track holds no items")
      no({ trackIndex = -1, midi = true, endTime = 2 }, "no MIDI notes")
      no({ trackIndex = 0, startTime = 3 }, "no items after")
      no({ trackIndex = 0, per = "half" }, 'per must be')
      midi.MAX_CHORD_SEGMENTS = 3
      no({ trackIndex = 0, per = "beat" }, "more than 3 beats")
    `);
  });
});
