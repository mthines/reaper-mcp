-- MCP Snapshot: Quick Save — save a snapshot with auto-generated name, no dialog
-- Bind to a key for rapid iteration. Named by the local time, e.g. "2026-10-30 14:32:05".

local info = debug.getinfo(1, "S")
local script_dir = info.source:match("@?(.*[\\/])")
local lib = dofile(script_dir .. "mcp_snapshot_lib.lua")

local name = lib.time_name()
local ok, err, track_count = lib.save_snapshot(name, "")
if ok then
  -- Make next/prev A/B start from the snapshot we just saved.
  lib.set_current_name(name)
  lib.toast("Saved: " .. name .. " (" .. (track_count or "?") .. " tracks)")
else
  lib.toast("Save failed: " .. (err or name))
end
