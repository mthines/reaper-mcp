-- MCP Snapshot: Previous — restore the previous snapshot in the list
-- Bind to a key for quick A/B testing. Wraps around at the beginning.

local info = debug.getinfo(1, "S")
local script_dir = info.source:match("@?(.*[\\/])")
local lib = dofile(script_dir .. "mcp_snapshot_lib.lua")

local snapshots = lib.load_snapshots()
if #snapshots == 0 then
  lib.toast("No snapshots found")
  return
end

local idx = lib.get_current_index()
idx = idx - 1
if idx < 1 then idx = #snapshots end

local snap = snapshots[idx]
local ok, err = lib.restore_snapshot(snap)
if ok then
  lib.set_current_index(idx)
  lib.toast("Snapshot " .. idx .. "/" .. #snapshots .. ": " .. snap.name)
else
  lib.toast("Restore failed: " .. (err or "unknown"))
end
