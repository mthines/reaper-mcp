#!/bin/bash
# Quick install script for the REAPER MCP bridge components.
# Usage: ./install.sh [REAPER_RESOURCE_PATH]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Detect REAPER resource path
if [ -n "$1" ]; then
  REAPER_PATH="$1"
elif [ -n "$REAPER_RESOURCE_PATH" ]; then
  REAPER_PATH="$REAPER_RESOURCE_PATH"
elif [ "$(uname)" = "Darwin" ]; then
  REAPER_PATH="$HOME/Library/Application Support/REAPER"
elif [ "$(uname)" = "Linux" ]; then
  REAPER_PATH="$HOME/.config/REAPER"
else
  echo "Could not detect REAPER resource path. Please provide it as an argument."
  echo "Usage: $0 /path/to/REAPER/resource/dir"
  exit 1
fi

echo "REAPER resource path: $REAPER_PATH"

# Install Lua bridge
SCRIPTS_DIR="$REAPER_PATH/Scripts"
mkdir -p "$SCRIPTS_DIR"
cp "$SCRIPT_DIR/mcp_bridge.lua" "$SCRIPTS_DIR/mcp_bridge.lua"
echo "Installed: $SCRIPTS_DIR/mcp_bridge.lua"

# Install JSFX analyzer
EFFECTS_DIR="$REAPER_PATH/Effects"
mkdir -p "$EFFECTS_DIR"
cp "$SCRIPT_DIR/mcp_analyzer.jsfx" "$EFFECTS_DIR/mcp_analyzer.jsfx"
echo "Installed: $EFFECTS_DIR/mcp_analyzer.jsfx"

# Create bridge data directory
BRIDGE_DIR="$SCRIPTS_DIR/mcp_bridge_data"
mkdir -p "$BRIDGE_DIR"
echo "Created: $BRIDGE_DIR"

echo ""
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Open REAPER"
echo "  2. Actions > Show action list > Load ReaScript"
echo "  3. Select: $SCRIPTS_DIR/mcp_bridge.lua"
echo "  4. Run the script (it runs persistently via defer loop)"
