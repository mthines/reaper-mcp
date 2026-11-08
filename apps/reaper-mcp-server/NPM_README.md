# reaper-mcp

**Type what you hear. An AI mix engineer inside your REAPER session measures it, decides and makes the change live.**

reaper-mcp connects Claude Code to a running REAPER session: tracks, FX, metering, MIDI, automation, rendering and more, plus mix skills (`/mixer`, `/critique`, `/mastering`, `/editing`, `/learn-plugin`) that know your plugins and genres.

## Install

You need [REAPER](https://www.reaper.fm/) (v6+), [Claude Code](https://claude.com/claude-code) and [Node.js 20+](https://nodejs.org/). In a terminal:

```bash
npm install -g @mthines/reaper-mcp
reaper-mcp setup     # installs the bridge and status page into REAPER
reaper-mcp init      # connects Claude Code and adds the mix skills
```

Then start REAPER (or restart it): `setup` adds the bridge to REAPER's startup script, so it starts with REAPER. Turn that off in the bridge window under **Settings → Start with REAPER**. Without a restart: **Actions → Show action list → Load ReaScript…**, pick `mcp_bridge.lua` and click **Run**.

Open Claude Code in any folder and try:

```
/mixer Please gain stage my tracks
/critique Roast my mix
```

## Something off?

```bash
reaper-mcp doctor    # checks every part and says how to fix it
reaper-mcp status    # is the bridge running in REAPER?
```

## Optional extras

- **Memory that learns your plugins and corrections:** connect the free [LoreKit](https://lorekit.io). `/learn-plugin` walks you through it.
- **Audio analysis (loudness, masking, stems):** `reaper-mcp setup-sidecar` (needs Python 3.10+).

## More

The full tour, screenshots, what it can control and how it keeps your session safe are in the [project README](https://github.com/mthines/reaper-mcp#readme). Developers can also install from a clone: see [For developers](https://github.com/mthines/reaper-mcp#%EF%B8%8F-for-developers).

MIT licensed. Usage telemetry is pseudonymous and can be turned off with `reaper-mcp telemetry off`; details in [TELEMETRY.md](https://github.com/mthines/reaper-mcp/blob/main/TELEMETRY.md).
