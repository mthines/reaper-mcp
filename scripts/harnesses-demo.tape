# `reaper-mcp init` finds the AI harnesses you have (Claude Code, Codex CLI, Gemini CLI, Cursor), connects each one
# and puts the skills where it reads them, typed for real into a sandboxed shell (see scripts/test-harnesses.sh,
# which sets DEMO_* and runs this). Doubles as the end-to-end test: every Wait fails the tape unless the line shows up.
# Codex CLI's and Gemini CLI's own `mcp list` are asked by that script afterwards, not here: `codex mcp list` printed
# nothing inside this recording's terminal.

Output docs/assets/harnesses-demo.gif

Require node

Set Shell bash
Set FontSize 16
Set Width 1280
Set Height 1040
Set Padding 28
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set TypingSpeed 35ms

Hide
Type `export HOME="$DEMO_HOME" PATH="$DEMO_PATH" REAPER_MCP_TELEMETRY=0 COLORTERM=truecolor PS1='\[\e[36m\]\w\[\e[0m\] \[\e[35m\]❯\[\e[0m\] ' && reaper-mcp() { node "$DEMO_PKG/main.js" "$@"; } && cd "$DEMO_HOME/Music" && [ "$HOME/Music" = "$PWD" ] && clear || exit 1`
Enter
Sleep 1s
Show

# 1. One command: it finds what is installed, connects it, and installs the skills
Sleep 800ms
Type "reaper-mcp init"
Sleep 600ms
Enter
Wait+Screen@60s /found +Claude Code/
Wait+Screen@60s /found +Codex CLI/
Wait+Screen@60s /found +Gemini CLI/
Wait+Screen@60s /found +Cursor/
Wait+Screen@60s /Connected: Cursor/
Wait+Screen@60s /Try: \/mixer/
Sleep 6s

# 2. The skills are where each one reads them
Type "clear"
Enter
Type "ls ~/.agents/skills"
Sleep 400ms
Enter
Wait+Screen@10s /mixer/
Sleep 3s

# 3. Running it again changes nothing
Type "clear"
Enter
Type "reaper-mcp init --harness codex,gemini,cursor | grep -v '^$'"
Sleep 400ms
Enter
Wait+Screen@30s /Already connected: Cursor/
Sleep 5s

# 4. Last: Claude Code's own list. It changes the terminal's keyboard mode, which would swallow later commands.
Type "clear"
Enter
Type "claude mcp list"
Sleep 400ms
Enter
Wait+Screen@90s /Connected/
Sleep 5s
