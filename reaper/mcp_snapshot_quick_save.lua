-- MCP Snapshot: Quick Save — save a snapshot with auto-generated name, no dialog
-- Bind to a key for rapid iteration. Names: "Snapshot 1", "Snapshot 2", etc.

local info = debug.getinfo(1, "S")
local script_dir = info.source:match("@?(.*[\\/])")
local lib = dofile(script_dir .. "mcp_snapshot_lib.lua")

local snapshots = lib.load_snapshots()

-- Find next available "Snapshot N" index
local next_idx = #snapshots + 1
for _, s in ipairs(snapshots) do
  local num = s.name:match("^Snapshot (%d+)$")
  if num then next_idx = math.max(next_idx, tonumber(num) + 1) end
end

local name = "Snapshot " .. next_idx
local ok, err, track_count = lib.save_snapshot(name, "")
if ok then
  -- Make next/prev A/B start from the snapshot we just saved.
  lib.set_current_name(name)
  lib.toast("Saved: " .. name .. " (" .. (track_count or "?") .. " tracks)")
else
  lib.toast("Save failed: " .. (err or name))
end
