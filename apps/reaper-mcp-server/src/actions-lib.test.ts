/**
 * Unit tests for reaper/mcp_actions_lib.lua, run in real Lua 5.4 (wasmoon)
 * against the fake ReaScript API (__fixtures__/fake_reaper.lua).
 * Assertions live in the Lua snippets: a failed `assert` rejects the promise.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_actions_lib.lua'), 'utf8');
const PLAN_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_plan_lib.lua'), 'utf8');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_reaper.lua'), 'utf8');

const factory = new LuaFactory();

// A small action table shaped like REAPER's main and MIDI editor sections.
const ACTIONS = `
ACTIONS = {
  [0] = {
    { id = 40001, name = "Track: Insert new track", shortcuts = { "Cmd+T" } },
    { id = 40005, name = "Track: Remove tracks" },
    { id = 40364, name = "Options: Toggle metronome", toggle = 0, shortcuts = { "Cmd+Opt+Shift+C" } },
    { id = 40004, name = "File: Quit REAPER" },
    { id = 40022, name = "File: Save project as..." },
    { id = 40860, name = "Close current project tab" },
    { id = 53000, name = "Custom: Split and select left", named = "aee8e5bd81464f8785373a3222b5d5c2" },
    { id = 54000, name = "SWS: Unselect all tracks", named = "SWS_UNSELALL" },
    { id = 55000, name = "Track: Insert new track" .. " (duplicate name)" },
    { id = 55001, name = "Item: Duplicate" },
    { id = 55002, name = "Item: Duplicate" },
  },
  [32060] = {
    { id = 40003, name = "Edit: Select all events" },
  },
}
KB = table.concat({
  'KEY 9 84 40001 0',
  'ACT 0 0 "aee8e5bd81464f8785373a3222b5d5c2" "Custom: Split and select left" 40001 _SWS_UNSELALL 99999',
  'SCR 4 0 RS1ee9bb "Custom: lyrics.lua" Cockos/lyrics.lua',
  'ACT 0 0 "tidyquit" "Custom: Tidy and quit" 40001 40004',
  'ACT 0 0 "renderstems" "Custom: Render stems" 40001 40022',
  'ACT 0 0 "outer" "Custom: Outer" 40364 _tidyquit',
  'ACT 0 0 "loopy" "Custom: Loop" _loopy 40001',
}, "\\n")
-- ACTIONS plus macros (see KB) and Save, for the safety-gate tests.
MORE = { [0] = {}, [32060] = ACTIONS[32060] }
for _, a in ipairs(ACTIONS[0]) do MORE[0][#MORE[0] + 1] = a end
for _, a in ipairs({
  { id = 40026, name = "File: Save project" },
  { id = 56000, name = "Custom: Tidy and quit", named = "tidyquit" },
  { id = 56001, name = "Custom: Render stems", named = "renderstems" },
  { id = 56002, name = "Custom: Outer", named = "outer" },
  { id = 56003, name = "Custom: Loop", named = "loopy" },
}) do MORE[0][#MORE[0] + 1] = a end
`;

async function runLua(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    lua.global.set('PLAN_SRC', PLAN_SRC);
    await lua.doString(FAKE_SRC);
    await lua.doString(
      `actions = load(LIB_SRC, "mcp_actions_lib.lua")()\nplan = load(PLAN_SRC, "mcp_plan_lib.lua")()\n${ACTIONS}\n${snippet}`,
    );
  } finally {
    lua.global.close();
  }
}

describe('mcp_actions_lib.lua (wasmoon)', () => {
  it('actions: search filters by all words and limits', async () => {
    await runLua(`
      local api = new_fake{ actions = ACTIONS }
      local r = actions.search(api, { query = "track INSERT" })
      assert(r.total == 2 and r.returned == 2, "two insert-track actions: " .. r.total)
      local a = r.actions[1]
      assert(a.id == 40001 and a.name == "Track: Insert new track" and a.toggle == -1)
      assert(a.shortcuts[1] == "Cmd+T" and a.namedId == nil and a.section == "main")

      local lim = actions.search(api, { query = "", limit = 3 })
      assert(lim.total == 11 and lim.returned == 3, "limit caps returned, total counts all")

      local named = actions.search(api, { query = "aee8e5bd" })
      assert(named.total == 1 and named.actions[1].namedId == "_aee8e5bd81464f8785373a3222b5d5c2", "matches named id")

      local tog = actions.search(api, { query = "metronome" }).actions[1]
      assert(tog.toggle == 0 and tog.shortcuts[1] == "Cmd+Opt+Shift+C")
      local dlg = actions.search(api, { query = "save as" }).actions[1]
      assert(dlg.opensDialog == true and dlg.denied == nil)
      assert(actions.search(api, { query = "quit" }).actions[1].denied, "quit is flagged denied")
      assert(actions.search(api, { query = "edit select", section = "midi_editor" }).total == 1)
      assert(api.writes == 0, "search writes nothing")
    `);
  });

  it('actions: get_action lists macro steps', async () => {
    await runLua(`
      local api = new_fake{ actions = ACTIONS }
      local g = actions.get(api, { action = "_aee8e5bd81464f8785373a3222b5d5c2" }, KB)
      assert(g.kind == "custom" and #g.steps == 3, "3 steps")
      assert(g.steps[1].id == 40001 and g.steps[1].name == "Track: Insert new track")
      assert(g.steps[2].id == 54000 and g.steps[2].name == "SWS: Unselect all tracks", "named step resolved")
      assert(g.steps[3].name:find("no such action"), "unknown step kept, not dropped")
      assert(actions.get(api, { action = 40001 }, KB).kind == "native")
      assert(actions.get(api, { action = "_SWS_UNSELALL" }, KB).kind == "extension")
    `);
  });

  it('actions: run resolves id, named id and exact name', async () => {
    await runLua(`
      local api = new_fake{ actions = ACTIONS }
      for _, ref in ipairs({ 40364, "40364", "options: toggle METRONOME" }) do
        local r, err = actions.run(api, { action = ref })
        assert(r and r.ran and r.id == 40364, tostring(err))
      end
      assert(#api.ran == 3 and api.begins == 3 and api.ends == 3, "one undo block per run")
      assert(api.undo[#api.undo] == "MCP: Options: Toggle metronome", "undo label names the action")
      local r = actions.run(api, { action = "_aee8e5bd81464f8785373a3222b5d5c2" })
      assert(r.id == 53000 and r.toggle == -1)
      local r2 = actions.run(api, { action = "aee8e5bd81464f8785373a3222b5d5c2" })
      assert(r2.id == 53000, "named id without underscore")
      local t = actions.run(api, { action = 40364 })
      assert(t.toggle == 0, "toggle state reported after the run (4th flip)")

      local _, amb = actions.run(api, { action = "Item: Duplicate" })
      assert(amb:find("ambiguous") and amb:find("55001"), amb)
      local _, nf = actions.run(api, { action = "No such action" })
      assert(nf:find("search_actions"), nf)
      local _, bad = actions.run(api, { action = 12345 })
      assert(bad:find("no action with id 12345"), bad)
      assert(#api.ran == 6, "failed resolutions ran nothing")
    `);
  });

  it('actions: safety refuses dialogs and deny-listed actions', async () => {
    await runLua(`
      local api = new_fake{ actions = ACTIONS }
      local _, e1 = actions.run(api, { action = 40022 })
      assert(e1:find("opens a dialog"), e1)
      local _, e2 = actions.run(api, { action = 40004, allowDialog = true })
      assert(e2:find("refused") and e2:find("close or replace"), e2)
      local _, e3 = actions.run(api, { action = "Close current project tab", allowDialog = true })
      assert(e3:find("refused"), e3)
      assert(#api.ran == 0 and api.writes == 0 and api.begins == 0, "nothing ran, no undo block")

      local ok = actions.run(api, { action = 40022, allowDialog = true })
      assert(ok and ok.ran, "allowDialog lets a dialog action run")
    `);
  });

  it('actions: midi section needs an open editor', async () => {
    await runLua(`
      local closed = new_fake{ actions = ACTIONS }
      local _, err = actions.run(closed, { action = 40003, section = "midi_editor" })
      assert(err:find("no MIDI editor is open"), err)
      assert(#closed.ran == 0)
      local _, bad = pcall(actions.run, closed, { action = 40003, section = "inline" })
      assert(tostring(bad):find("unknown section"), tostring(bad))

      local open = new_fake{ actions = ACTIONS, midi_editor = true }
      local r = actions.run(open, { action = 40003, section = "midi_editor" })
      assert(r.ran and open.ran[1].section == 32060, "ran in the MIDI editor section")
    `);
  });

  it('actions: selection replace and add', async () => {
    await runLua(`
      local api = new_fake{ tracks = {
        { name = "Kick", selected = true, items = 2 }, { name = "Snare", items = 1 }, { name = "Bass" },
      } }
      local r = actions.set_selected_tracks(api, { "Snare", 2 }, "replace", plan.resolve_track)
      assert(#r.selected == 2 and r.selected[1].name == "Snare" and r.selected[2].name == "Bass", "replace")
      r = actions.set_selected_tracks(api, { "Kick" }, "add", plan.resolve_track)
      assert(#r.selected == 3, "add keeps existing")

      local before = api.writes
      local _, err = actions.set_selected_tracks(api, { "Snare", "Nope" }, "replace", plan.resolve_track)
      assert(err:find("tracks%[1%]") and err:find("unchanged"), err)
      assert(api.writes == before, "unknown track changes nothing")

      api.tracks[1].items[1].selected = true
      local i = actions.set_selected_items(api, { { trackIndex = 1, itemIndex = 0 } }, "replace")
      assert(#i.selected == 1 and i.selected[1].trackIndex == 1, "replace clears the other item")
      i = actions.set_selected_items(api, { { trackIndex = 0, itemIndex = 1 } }, "add")
      assert(#i.selected == 2, "add keeps existing")
      local _, ierr = actions.set_selected_items(api, { { trackIndex = 2, itemIndex = 0 } }, "replace")
      assert(ierr:find("no item 0 on track 2"), ierr)
      assert(#actions.set_selected_items(api, { { trackIndex = 1, itemIndex = 0 } }, "add").selected == 2, "failed call left selection intact")
    `);
  });

  it('actions: kb.ini parser reads macros and scripts', async () => {
    await runLua(`
      local m, s = actions.parse_kb(KB .. '\\nACT 2 32060 "abc" "Custom: midi thing" 40003\\ngarbage line'
        .. '\\nSCR 4 0 RSquoted "Custom: spaced.lua" "My Scripts/spaced name.lua"')
      assert(m["_aee8e5bd81464f8785373a3222b5d5c2"].steps[2] == "_SWS_UNSELALL")
      assert(m["_abc"].section == 32060 and m["_abc"].steps[1] == "40003")
      assert(s["_RS1ee9bb"].path == "Cockos/lyrics.lua")
      assert(s["_RSquoted"].path == "My Scripts/spaced name.lua", "quotes stripped: " .. s["_RSquoted"].path)
    `);
  });

  it('actions: a macro is judged by the steps it runs', async () => {
    await runLua(`
      local api = new_fake{ actions = MORE }
      local _, e1 = actions.run(api, { action = "_tidyquit", allowDialog = true }, KB)
      assert(e1 and e1:find("refused: macro step 2: 'File: Quit REAPER'"), tostring(e1))
      local _, e2 = actions.run(api, { action = "_outer", allowDialog = true }, KB)
      assert(e2 and e2:find("macro step 2: macro step 2:"), "nested macro checked: " .. tostring(e2))
      local _, e3 = actions.run(api, { action = "_renderstems" }, KB)
      assert(e3 and e3:find("macro step 2 'File: Save project as...' opens a dialog"), tostring(e3))
      assert(#api.ran == 0 and api.begins == 0, "nothing ran")

      assert(actions.run(api, { action = "_renderstems", allowDialog = true }, KB).ran, "allowDialog covers a dialog step")
      assert(actions.run(api, { action = "_loopy" }, KB).ran, "a self-referencing macro does not loop forever")

      local found = actions.search(api, { query = "custom tidy" }, KB).actions[1]
      assert(found.denied and found.denied:find("Quit"), "search flags the macro denied")
      local g = actions.get(api, { action = "_renderstems" }, KB)
      assert(g.opensDialog == true and g.denied == nil, "get flags the dialog step")
      assert(actions.search(api, { query = "custom tidy" }).actions[1].denied == nil, "without kb.ini only the name counts")
    `);
  });

  it('actions: deny list matches REAPER\'s real project and tab action names', async () => {
    await runLua(`
      for _, name in ipairs({
        "File: Quit REAPER", "Close current project tab", "Close project", "Close all projects",
        "Close all projects but current", "File: Close all projects", "New project", "New project tab",
        "New project tab (ignore default template)", "New project (ignore default template)",
        "File: New project", "File: Open project", "Open project", "Open project in new tab",
        "Project tabs: switch to next project tab", "Project tabs: close all but current",
        -- SWS / item actions seen in a live REAPER 7.40 + SWS 2.14 action list
        "SWS: Switch to project tab 1", "SWS: Switch to last project tab", "SWS: Open last project",
        "SWS: Open projects from list", "SWS: Open related project 1",
        "SWS/S&M: Resources - Open project, slot 1", "SWS/S&M: Resources - Open project, slot 1 (new tab)",
        "SWS/S&M: Region Playlist - Crop project to playlist (new project tab)",
        "Item: Open associated project in new tab", "Xenakios/SWS: Open associated REAPER project of item",
        "Xenakios/SWS: Open REAPER project in item BWAV info (autosearch for RPP if necessary)",
        "Action: Momentarily send next action to project tab 1",
      }) do
        assert(actions.deny_reason(name), "should be denied: " .. name)
      end
      for _, name in ipairs({
        "New project bay window", "File: Open render queue", "Project tabs: move project tab left by one",
        "Track: Insert new track", "Open project settings",
        "SWS/S&M: Open/close Notes window (project notes)", "SWS/S&M: Open project path in explorer/finder",
        "SWS: Open project list", "SWS: Save list of open projects", "Project tabs: Run background projects",
      }) do
        assert(actions.deny_reason(name) == nil, "should run: " .. name)
      end
    `);
  });

  it('actions: Save on a never-saved project opens a dialog', async () => {
    await runLua(`
      local unsaved = new_fake{ actions = MORE }
      local _, err = actions.run(unsaved, { action = 40026 })
      assert(err and err:find("opens a dialog"), tostring(err))
      assert(actions.search(unsaved, { query = "file save project" }).actions[1].opensDialog == true)
      assert(actions.opens_dialog(unsaved, "File: Save new version of project (automatically increment project name)"))
      assert(actions.opens_dialog(unsaved, "File: Save all projects"))
      assert(not actions.opens_dialog(unsaved, "Track: Insert new track"))

      local saved = new_fake{ actions = MORE, project_path = "/tmp/song.RPP" }
      assert(actions.run(saved, { action = 40026 }).ran, "a saved project saves without a dialog")
      assert(not actions.opens_dialog(saved, "File: Save all projects"))
    `);
  });
});
