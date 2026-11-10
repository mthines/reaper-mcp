# `reaper-mcp telemetry`: what is collected, and the opt-out with its one confirmation, typed for real into a sandboxed shell (see scripts/test-harnesses.sh).

Output docs/assets/telemetry-demo.gif

Require node

Set Shell bash
Set FontSize 16
Set Width 1280
Set Height 900
Set Padding 28
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set TypingSpeed 35ms

Hide
Type `export HOME="$DEMO_HOME" PATH="$DEMO_PATH" REAPER_RESOURCE_PATH="$DEMO_REAPER" NODE_OPTIONS="--require $DEMO_NONET" COLORTERM=truecolor PS1='\[\e[36m\]\w\[\e[0m\] \[\e[35m\]❯\[\e[0m\] ' && reaper-mcp() { node "$DEMO_PKG/main.js" "$@"; } && cd "$DEMO_HOME/Music" && [ "$HOME/Music" = "$PWD" ] && clear || exit 1`
Enter
Sleep 1s
Show

Sleep 800ms
Type "reaper-mcp telemetry status"
Sleep 600ms
Enter
Sleep 4s

# Turning it off asks once more: Enter keeps it on
Type "clear"
Enter
Type "reaper-mcp telemetry off"
Sleep 600ms
Enter
Sleep 3s
Enter
Sleep 4s

# Said yes this time
Type "clear"
Enter
Type "reaper-mcp telemetry off"
Sleep 600ms
Enter
Sleep 3s
Type "y"
Sleep 600ms
Enter
Sleep 5s

Type "reaper-mcp telemetry status | tail -2"
Sleep 600ms
Enter
Sleep 4s
