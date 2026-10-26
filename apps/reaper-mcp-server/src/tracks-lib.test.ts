/**
 * Unit tests for reaper/mcp_tracks_lib.lua (track structure + routing), run in
 * real Lua 5.4 (wasmoon) against the fake ReaScript API.
 * Assertions live in the Lua snippets: a failed `assert` rejects the promise.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_tracks_lib.lua'), 'utf8');
const PLAN_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_plan_lib.lua'), 'utf8');
const FAKE_SRC = readFileSync(join(__dirname, '__fixtures__/fake_reaper.lua'), 'utf8');

const factory = new LuaFactory();

async function runLua(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    lua.global.set('PLAN_SRC', PLAN_SRC);
    await lua.doString(FAKE_SRC);
    await lua.doString(`
      tracks = load(LIB_SRC, "mcp_tracks_lib.lua")()
      plan = load(PLAN_SRC, "mcp_plan_lib.lua")()
      function names(api)
        local out = {}
        for i = 0, api.CountTracks(0) - 1 do out[#out + 1] = api.tracks[i + 1].name end
        return table.concat(out, ",")
      end
      function mixer() return new_fake{ tracks = { { name = "Kick" }, { name = "Snare" }, { name = "Bass" }, { name = "Bus" } } } end
      ${snippet}`);
  } finally {
    lua.global.close();
  }
}

describe('mcp_tracks_lib.lua (wasmoon)', () => {
  it('tracks: master ref resolves to the master track', async () => {
    await runLua(`
      local api = mixer()
      for _, ref in ipairs({ "master", "MASTER", "Master", -1, "-1" }) do
        local r = plan.resolve_track(api, ref, {})
        assert(r and r.track == api.master, "ref " .. tostring(ref))
      end
      assert(plan.resolve_track(api, "Kick", {}).track == api.tracks[1], "names still resolve")
      local _, conflicts = plan.validate(api, { { op = "add_send", from = "Kick", to = "master" } }, {})
      assert(#conflicts == 1 and conflicts[1].error:find("masterSend"), "run_plan refuses a send into the master")
      local d = tracks.describe_track(api, api.master)
      assert(d.index == -1 and d.name == "MASTER", "master describes as index -1")
    `);
  });

  it('tracks: add, delete and move', async () => {
    await runLua(`
      local api = mixer()
      local a = tracks.add_track(api, { name = "Vox", index = 1 })
      assert(a.index == 1 and a.name == "Vox" and names(api) == "Kick,Vox,Snare,Bass,Bus", names(api))
      local e = tracks.add_track(api, {})
      assert(e.index == 5 and names(api) == "Kick,Vox,Snare,Bass,Bus,", "default appends: " .. names(api))

      local d = tracks.delete_track(api, api.tracks[6])
      assert(d.trackCount == 5 and names(api) == "Kick,Vox,Snare,Bass,Bus")

      api.tracks[3].selected = true -- the user's selection survives a move
      local m = tracks.move_track(api, api.tracks[1], 3)
      assert(m.moved and names(api) == "Vox,Snare,Bass,Kick,Bus", "down: " .. names(api))
      tracks.move_track(api, api.tracks[4], 0)
      assert(names(api) == "Kick,Vox,Snare,Bass,Bus", "up: " .. names(api))
      tracks.move_track(api, api.tracks[1], 4)
      assert(names(api) == "Vox,Snare,Bass,Bus,Kick", "to the end: " .. names(api))
      assert(api.tracks[2].selected == true and not api.tracks[5].selected, "selection restored")
      assert(tracks.move_track(api, api.tracks[1], 0).moved == false, "same place is a no-op")
    `);
  });

  it('tracks: folder, name and color', async () => {
    await runLua(`
      local api = mixer()
      local f = tracks.set_track_folder(api, api.tracks[4], { mode = "folder", collapsed = 2 })
      assert(f.folderDepth == 1 and f.folderCollapsed == 2)
      assert(tracks.set_track_folder(api, api.tracks[2], { mode = "last" }).folderDepth == -1)
      assert(tracks.set_track_folder(api, api.tracks[2], { mode = "normal" }).folderDepth == 0)

      local i = tracks.set_track_info(api, api.tracks[1], { name = "Kick In", color = "#ff8000", channels = 4 })
      assert(i.name == "Kick In" and i.color == "#FF8000" and i.channels == 4, tostring(i.color))
      assert(tracks.set_track_info(api, api.tracks[1], { color = "none" }).color == nil, "color cleared")
      local m = tracks.set_track_info(api, api.master, { color = "#102030" })
      assert(m.color == "#102030", "master can be colored")
    `);
  });

  it('routing: add, edit and remove sends', async () => {
    await runLua(`
      local api = mixer()
      local kick, bus = api.tracks[1], api.tracks[4]
      local r = tracks.add_send(api, kick, bus, { volume = -6, pan = -0.5, mode = "pre-fx", mute = true })
      local s = r.send
      assert(s.index == 0 and s.destTrack.name == "Bus" and math.abs(s.volume + 6) < 1e-9, "level")
      assert(s.pan == -0.5 and s.muted and s.mode == "pre-fx" and s.destChannel == 1)

      local recv = tracks.routing(api, bus).receives[1]
      assert(recv.srcTrack.name == "Kick", "the send shows as the bus's receive")

      local e = tracks.set_send(api, kick, { index = 0, volume = 0, mute = false, mode = "post-fader" })
      assert(math.abs(e.send.volume) < 1e-9 and not e.send.muted and e.send.mode == "post-fader")
      local er = tracks.set_send(api, bus, { category = "receive", index = 0, pan = 0.25 })
      assert(er.receive.pan == 0.25 and tracks.routing(api, kick).sends[1].pan == 0.25, "editing a receive edits the send")

      local rm = tracks.remove_send(api, kick, { index = 0 })
      assert(rm.remaining == 0 and #tracks.routing(api, bus).receives == 0, "gone on both ends")
      local _, into_master = tracks.add_send(api, kick, api.master, {})
      assert(into_master and into_master:find("masterSend"), "a send into the master points at masterSend: " .. tostring(into_master))
    `);
  });

  it('routing: sidechain into channels 3/4 widens the destination', async () => {
    await runLua(`
      local api = mixer()
      local kick, bass = api.tracks[1], api.tracks[3]
      assert(tracks.routing(api, bass).channels == 2)
      local r = tracks.add_send(api, kick, bass, { destChannel = 3, mode = "pre-fx" })
      assert(r.send.destChannel == 3 and tracks.routing(api, bass).channels == 4, "bass now has 4 channels")
      tracks.set_send(api, kick, { index = 0, destChannel = 5 })
      assert(tracks.routing(api, bass).channels == 6 and tracks.routing(api, kick).sends[1].destChannel == 5)
      -- A mono-mixed send moves to 3/4 and stays mono; the destination gets 4 channels, not 1028.
      local mono = tracks.add_send(api, api.tracks[2], api.tracks[4], {}).send
      api.SetTrackSendInfo_Value(api.tracks[2], 0, mono.index, "I_DSTCHAN", 1024)
      api.SetTrackSendInfo_Value(api.tracks[2], 0, mono.index, "I_SRCCHAN", 1024) -- mono source
      tracks.set_send(api, api.tracks[2], { index = mono.index, destChannel = 3, srcChannel = 2 })
      assert(api.GetTrackSendInfo_Value(api.tracks[2], 0, mono.index, "I_DSTCHAN") == 2 | 1024, "mono bit kept")
      assert(api.GetTrackSendInfo_Value(api.tracks[2], 0, mono.index, "I_SRCCHAN") == 1 | 1024, "source width kept")
      assert(tracks.routing(api, api.tracks[4]).channels == 4, "bus widened to 4: " .. tracks.routing(api, api.tracks[4]).channels)
      local _, err = tracks.add_send(api, kick, bass, { destChannel = 0 })
      assert(err and err:find("destChannel"), tostring(err))
    `);
  });

  it('routing: hardware outputs and master send', async () => {
    await runLua(`
      local api = mixer()
      local snare = api.tracks[2]
      local h = tracks.add_hardware_output(api, snare, { outputChannel = 3, volume = -3 }).hardwareOutput
      assert(h.outputChannel == 3 and not h.mono and math.abs(h.volume + 3) < 1e-9)
      local m = tracks.add_hardware_output(api, snare, { outputChannel = 5, mono = true }).hardwareOutput
      assert(m.index == 1 and m.outputChannel == 5 and m.mono)
      local e = tracks.set_send(api, snare, { category = "hardware", index = 0, outputChannel = 7 })
      assert(e.hardware.outputChannel == 7)
      local keep = tracks.set_send(api, snare, { category = "hardware", index = 1, outputChannel = 9 }).hardware
      assert(keep.outputChannel == 9 and keep.mono, "a channel edit keeps mono")
      local st = tracks.set_send(api, snare, { category = "hardware", index = 1, mono = false }).hardware
      assert(st.outputChannel == 9 and not st.mono, "mono alone switches to stereo, same channel")
      assert(#tracks.routing(api, snare).hardwareOutputs == 2 and #tracks.routing(api, snare).sends == 0)

      assert(tracks.routing(api, snare).masterSend == true, "master send defaults on")
      assert(tracks.set_track_info(api, snare, { masterSend = false }).masterSend == false)
      assert(tracks.routing(api, snare).masterSend == false)
      assert(tracks.remove_send(api, snare, { category = "hardware", index = 1 }).remaining == 1)
    `);
  });

  it('routing: groups and VCA', async () => {
    await runLua(`
      local api = mixer()
      local bus, kick = api.tracks[4], api.tracks[1]
      local l = tracks.set_track_group(api, bus, { group = 1, roles = { "vca_lead" } })
      assert(#l.roles == 1 and l.roles[1] == "vca_lead")
      local f = tracks.set_track_group(api, kick, { group = 1, roles = { "vca_follow", "mute_follow" } })
      assert(table.concat(f.roles, ",") == "mute_follow,vca_follow", table.concat(f.roles, ","))
      local hi = tracks.set_track_group(api, kick, { group = 40, roles = { "solo_follow" } })
      assert(hi.roles[1] == "solo_follow" and #tracks.group_roles(api, kick, 1) == 2, "groups 33-64 are separate")
      local off = tracks.set_track_group(api, kick, { group = 1, roles = { "mute_follow" }, enable = false })
      assert(table.concat(off.roles, ",") == "vca_follow")
    `);
  });

  it('routing: read back reports index, mode, channels, hardware and master send', async () => {
    await runLua(`
      local api = mixer()
      local kick, bus = api.tracks[1], api.tracks[4]
      tracks.add_send(api, kick, bus, { mode = "post-fx", srcChannel = 1, destChannel = 3 })
      tracks.add_hardware_output(api, kick, { outputChannel = 1 })
      local r = tracks.routing(api, kick)
      local s = r.sends[1]
      assert(s.index == 0 and s.mode == "post-fx" and s.srcChannel == 1 and s.destChannel == 3)
      assert(#r.hardwareOutputs == 1 and r.hardwareOutputs[1].outputChannel == 1)
      assert(r.masterSend == true and r.channels == 2 and #r.receives == 0)
      assert(tracks.routing(api, api.master).masterSend == nil, "master has no master send")
    `);
  });

  it('tracks: refusals change nothing', async () => {
    await runLua(`
      local api = mixer()
      local before = api.writes
      local _, e1 = tracks.delete_track(api, api.master)
      assert(e1:find("master"), e1)
      local _, e2 = tracks.move_track(api, api.tracks[1], 9)
      assert(e2:find("out of range"), e2)
      local _, e3 = tracks.set_send(api, api.tracks[1], { index = 0, volume = -3 })
      assert(e3:find("not found"), e3)
      local _, e4 = tracks.remove_send(api, api.tracks[1], { category = "hardware", index = 2 })
      assert(e4:find("not found"), e4)
      local _, e5 = tracks.set_track_info(api, api.tracks[1], { name = "X", color = "orange" })
      assert(e5:find("#RRGGBB"), e5)
      local _, e6 = tracks.set_track_info(api, api.tracks[1], { channels = 3 })
      assert(e6:find("even"), e6)
      local _, e7 = tracks.set_track_group(api, api.tracks[1], { group = 1, roles = { "vca_follow", "boss" } })
      assert(e7:find("unknown role 'boss'"), e7)
      local _, e8 = tracks.add_send(api, api.tracks[1], api.tracks[1], {})
      assert(e8:find("itself"), e8)
      local _, e9 = tracks.add_send(api, api.tracks[1], api.tracks[2], { pan = 2 })
      assert(e9:find("pan"), e9)
      local _, e10 = tracks.add_track(api, { index = 99 })
      assert(e10:find("out of range"), e10)
      assert(api.writes == before and api.tracks[1].name == "Kick", "nothing written")
      local _, e11 = plan.resolve_track(api, "Nope", {})
      assert(e11:find("not found"), e11)
    `);
  });
});
