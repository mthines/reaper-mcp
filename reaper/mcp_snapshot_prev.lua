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

-- Resolve current position by name (stable across add/delete/re-sort).
local cur = lib.get_current_name()
local idx = 0
for i, s in ipairs(snapshots) do
  if s.name == cur then idx = i; break end
end
-- If not found (idx 0), idx-1 wraps to the last snapshot.
idx = idx - 1
if idx < 1 then idx = #snapshots end

local snap = snapshots[idx]
local ok, err, _, warnings = lib.restore_snapshot(snap)
if ok then
  lib.set_current_name(snap.name)
  local w = (warnings and #warnings > 0) and (" [" .. #warnings .. " warning(s)]") or ""
  lib.toast("Snapshot " .. idx .. "/" .. #snapshots .. ": " .. snap.name .. w)
else
  lib.toast("Restore failed: " .. (err or "unknown"))
end
