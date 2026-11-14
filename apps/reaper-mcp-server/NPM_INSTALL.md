## 🚀 Install in 3 steps

<img src="docs/assets/install-steps.svg" alt="1. Get REAPER, Claude Code and Node.js. 2. Paste one command. 3. Click Run on mcp_bridge.lua in REAPER." width="100%">

### 1 · Get the apps

| | | |
|---|---|---|
| 🎚️ **REAPER** | your DAW (v6+, v7 recommended) | [reaper.fm](https://www.reaper.fm/) |
| 🤖 **Claude Code** | the AI you talk to (never used it? [set it up](https://reaper-mcp.vercel.app/docs/set-up-your-ai-app)) | [claude.com/claude-code](https://claude.com/claude-code) |
| 🟢 **Node.js 20+** | runs the connector behind the scenes | [nodejs.org](https://nodejs.org/) |
| 🧠 **LoreKit** *(recommended)* | the memory, so it learns (add it after; [how](https://reaper-mcp.vercel.app/docs/connect-lorekit)) | [lorekit.io](https://lorekit.io) |
| ➕ **SWS Extensions** *(optional)* | extra REAPER powers | [sws-extension.org](https://www.sws-extension.org/) |

### 2 · Paste these commands

Open a terminal, then run:

```bash
npm install -g @mthines/reaper-mcp
reaper-mcp setup     # installs the bridge and status page into REAPER
reaper-mcp init      # connects Claude Code and adds the mix skills
```

That's it. No clone, no build. To update later, run `reaper-mcp update` (or press **Update** in the bridge window in REAPER, which
does the same in the background and then offers **Reload**).

<details>
<summary><b>Prefer ReaPack for the REAPER side?</b></summary>

In REAPER: **Extensions → ReaPack → Import repositories…**, paste
`https://github.com/mthines/reaper-mcp/releases/latest/download/index.xml`, then **Browse packages**,
search `reaper-mcp` and install the three packages (bridge, meters, status page). ReaPack then offers
updates like any other package. The server and Claude Code side is still
`npm install -g @mthines/reaper-mcp && reaper-mcp init` (ReaPack can't edit REAPER's startup script or
turn on its web interface, so run `reaper-mcp setup` once too if you want the bridge to start with REAPER).

</details>

### 3 · Start REAPER

Start REAPER, or restart it if it was open: `reaper-mcp setup` added the bridge to REAPER's
startup script, so it starts with REAPER. A small status window opens, showing the bridge
is live. 🟢 Don't want it starting on its own? Turn off **Settings → Start with REAPER** in
that window.

Rather not restart? **Actions → Show action list → Load ReaScript…**, pick **`mcp_bridge.lua`**
and click **Run**. Running it again stops the bridge.

**Now open Claude Code in any folder (your song folder is perfect) and start mixing:**

```
/mixer Please gain stage my tracks
```

### Then: give it a memory *(optional, about five minutes)*

Out of the box it starts every conversation from scratch. Connect [LoreKit](https://lorekit.io) and it keeps
what it learns about your plugins and your corrections, in every project:

1. Sign in at [lorekit.io](https://lorekit.io), then **Settings → API keys → Generate new token** (read + write, starts with `lk_rw_`).
2. Paste this in a terminal with your key, then restart Claude Code:

```bash
claude mcp add --transport http --scope user lorekit https://pqokxlhvnosogizsjztg.supabase.co/functions/v1/mcp --header "Authorization: Bearer lk_rw_YOUR_KEY"
```

3. Type `/mcp` in Claude Code: `reaper` and `lorekit` should both be connected. Then teach it a plugin: `/learn-plugin Soothe2`.

`--scope user` makes it work in every folder (LoreKit's own page shows a per-folder file). Step by step, with fixes:
**[Connect LoreKit](https://reaper-mcp.vercel.app/docs/connect-lorekit)** · **[Teach it your plugins](https://reaper-mcp.vercel.app/docs/teach-it-a-plugin)**

<details>
<summary><b>Something not working?</b></summary>

<br>

- **Run `reaper-mcp doctor`.** It checks the bridge, whether it starts with REAPER, the skills and the Claude Code config, and says how to fix what's off.
- **Is the bridge running?** The status window shows 🟢 when it is. If not, run `mcp_bridge.lua` again from REAPER's action list.
- **Claude Code doesn't see REAPER?** Install Claude Code first, then run `reaper-mcp init` again.
- **Missing skills?** `reaper-mcp install-skills` copies them into `~/.claude` (it never overwrites files you edited).
- **Audio analysis (loudness, masking, stems)?** `reaper-mcp setup-sidecar` (needs Python 3.10+).

</details>

---

