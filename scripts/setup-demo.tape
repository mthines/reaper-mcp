# `reaper-mcp setup`: installs the Lua bridge, JSFX, example plugins and status page into a REAPER folder, then offers init and doctor (Enter, Enter), typed for real
# into a sandboxed shell (scripts/test-harnesses.sh sets DEMO_* and runs this). test-harnesses.sh then checks the REAPER folder it installed into.

Output docs/assets/setup-demo.gif

Require node

Set Shell bash
Set FontSize 16
Set Width 1280
Set Height 1100
Set Padding 28
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set TypingSpeed 35ms

Hide
Type `export HOME="$DEMO_HOME" PATH="$DEMO_PATH" REAPER_RESOURCE_PATH="$DEMO_REAPER" REAPER_MCP_TELEMETRY=0 COLORTERM=truecolor PS1='\[\e[36m\]\w\[\e[0m\] \[\e[35m\]❯\[\e[0m\] ' && reaper-mcp() { node "$DEMO_PKG/main.js" "$@"; } && cd "$DEMO_HOME/Music" && [ "$HOME/Music" = "$PWD" ] && clear || exit 1`
Enter
Sleep 1s
Show

Sleep 800ms
Type "reaper-mcp setup"
Sleep 600ms
Enter

# Setup offers the next two steps: Enter, Enter (fixed pauses: the screen reader is unreliable on this much output)
Sleep 6s
Enter
Sleep 9s
Enter
Sleep 12s
