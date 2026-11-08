## 🚀 Install in 3 steps

<img src="docs/assets/install-steps.svg" alt="1. Get REAPER, Claude Code and Node.js. 2. Paste one command. 3. Click Run on mcp_bridge.lua in REAPER." width="100%">

### 1 · Get the apps

| | | |
|---|---|---|
| 🎚️ **REAPER** | your DAW (v6+, v7 recommended) | [reaper.fm](https://www.reaper.fm/) |
| 🤖 **Claude Code** | the AI you talk to | [claude.com/claude-code](https://claude.com/claude-code) |
| 🟢 **Node.js 20+** | runs the connector behind the scenes | [nodejs.org](https://nodejs.org/) |
| 🧠 **LoreKit** *(recommended)* | the memory, so it learns | [lorekit.io](https://lorekit.io) |
| ➕ **SWS Extensions** *(optional)* | extra REAPER powers | [sws-extension.org](https://www.sws-extension.org/) |

### 2 · Paste these commands

Open a terminal, then run:

```bash
npm install -g @mthines/reaper-mcp
reaper-mcp setup     # installs the bridge and status page into REAPER
reaper-mcp init      # connects Claude Code and adds the mix skills
```

That's it. No clone, no build. To update later, run `npm install -g @mthines/reaper-mcp` again,
then `reaper-mcp setup`. The bridge window in REAPER also shows an **Update** notice.

### 3 · Click Run in REAPER

In REAPER: **Actions → Show action list → Load ReaScript…**, pick **`mcp_bridge.lua`**
and click **Run**. A small status window opens, showing the bridge is live. 🟢
Running it again stops the bridge.

**Now open Claude Code in any folder (your song folder is perfect) and start mixing:**

```
/mixer Please gain stage my tracks
```

<details>
<summary><b>Something not working?</b></summary>

<br>

- **Run `reaper-mcp doctor`.** It checks the bridge, the skills and the Claude Code config, and says how to fix what's off.
- **Is the bridge running?** The status window shows 🟢 when it is. If not, run `mcp_bridge.lua` again from REAPER's action list.
- **Claude Code doesn't see REAPER?** Install Claude Code first, then run `reaper-mcp init` again.
- **Missing skills?** `reaper-mcp install-skills` copies them into `~/.claude` (it never overwrites files you edited).
- **Audio analysis (loudness, masking, stems)?** `reaper-mcp setup-sidecar` (needs Python 3.10+).

</details>

---

