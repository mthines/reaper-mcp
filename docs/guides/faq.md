---
title: FAQ and fixes
nav: FAQ and fixes
summary: Quick answers to the questions people ask first, and what to try when something isn't working.
section: know
order: 4
---

## Questions

### Do I need to know how to code?

No. You paste three commands to install, then type in plain words.

### Is this voice control?

No. You type to it, like any chat. Use your OS dictation if you'd rather speak.

### Will it replace me?

No. It handles the tedious, measurable parts. Taste and the final call stay with you, and it explains itself so you can push back. See [honest expectations](honest-expectations.md).

### Can it wreck my project?

Every edit is one undo step, and the mix skills snapshot first. [What is and isn't guarded](undo-and-safety.md).

### Do my audio files get uploaded?

No. reaper-mcp analyses audio on your computer. The assistant sees measurements and settings, not your audio files. Your AI provider sees what the assistant sees, like track names and plugin settings.

### What does it cost?

reaper-mcp and LoreKit are free and open source. You need REAPER and an AI app plan.

### Which plugins does it work with?

Any plugin REAPER can load. It knows some already, and [learns](teach-it-a-plugin.md) the rest.

### Which AI apps?

Claude Code is the one it's built and tested around. Codex CLI, Gemini CLI and Cursor connect with `reaper-mcp init`.

### Do I need LoreKit?

No. Without it, everything works but it starts fresh each conversation, and `/learn-plugin` can't save. [Connect it](connect-lorekit.md) when you want it to remember.

### What does it collect?

See [what gets collected](telemetry.md). Short version: counts of which tools ran, never your projects, names or audio, and you can turn it off.

## Fixes

### The status window doesn't show a green light.

The connector isn't running. In REAPER, run `mcp_bridge.lua` from the action list.

### My AI app can't see REAPER.

Run `reaper-mcp init` again after installing the AI app. Then `reaper-mcp doctor`.

### `/mixer` and `/critique` aren't found.

Run `reaper-mcp install-skills`.

### The assistant says memory isn't connected.

In Claude Code, type `/mcp`. If `lorekit` isn't there, follow [Connect LoreKit](connect-lorekit.md). If it works in one folder but not another, it was added for that folder only: add it again with `--scope user`.

### Loudness, masking or stem tools fail.

Install the audio add-on: `reaper-mcp setup-sidecar` (Python 3.10+).

### The window shows an old version.

Run `reaper-mcp update`, or use **Update** in the window, then **Reload**.

### Everything's weird.

Run `reaper-mcp doctor` first. It names the broken piece.

Still stuck? Ask in the [Discord](https://discord.gg/Eg8tznuXp4) or [open an issue](https://github.com/mthines/reaper-mcp/issues).
