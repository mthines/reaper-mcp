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
lib.ensure_snapshot_dir()

local snapshot = {
  name = name,
  description = "",
  timestamp = os.time() * 1000,
  mixerState = lib.capture_mixer_state(),
}

local path = lib.snapshot_path(name)
local ok = lib.write_file(path, lib.json_encode(snapshot))
if ok then
  -- Set current index to the new snapshot so next/prev starts from here
  local updated = lib.load_snapshots()
  for i, s in ipairs(updated) do
    if s.name == name then
      lib.set_current_index(i)
      break
    end
  end
  lib.toast("Saved: " .. name .. " (" .. #snapshot.mixerState.tracks .. " tracks)")
else
  lib.toast("Save failed: " .. path)
end
