# The README install flow, typed for real into a sandboxed shell (see
# scripts/test-install.sh, which sets DEMO_* and runs this). Doubles as the
# end-to-end install test: it fails unless the installer prints "Done!".

Output docs/assets/install-demo.gif

Require git
Require node

Set Shell bash
Set FontSize 18
Set Width 1280
Set Height 620
Set Padding 28
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set TypingSpeed 35ms

Hide
Type `export HOME="$DEMO_HOME" PATH="$DEMO_PATH" REAPER_RESOURCE_PATH="$DEMO_REAPER" NX_NO_CLOUD=true NX_DAEMON=false PS1='\[\e[36m\]\w\[\e[0m\] \[\e[35m\]❯\[\e[0m\] ' && cd "$DEMO_HOME/Music" && [ "$HOME/Music" = "$PWD" ] && clear || exit 1`
Enter
Sleep 1s
Show

Sleep 800ms
Type "git clone https://github.com/mthines/reaper-mcp.git && cd reaper-mcp && ./scripts/install.sh"
Sleep 600ms
Enter

Wait+Screen@5m /Done!/
Sleep 5s
