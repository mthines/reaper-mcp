---
title: What gets collected, and what never does
nav: What’s collected
summary: What the usage numbers are for, exactly what's sent, what never leaves your machine, and how to turn it off.
section: safe
order: 2
poster: media/bridge-status.png
duration: 3 min
---

Hey, I'm Mads, and I build reaper-mcp. I'm a programmer at [Dash0](https://www.dash0.com), I play in a band called [Kaiju](https://open.spotify.com/artist/2R3yJQTWO9bfSzWldmhR6x) in my spare time, and I'm a father of three. So this gets built in the gaps. I made it to take the trivial parts of recording off my plate (naming, routing, levels), so I have more time for writing, playing and having fun. It's the tool I wanted for my own sessions.

The usage numbers are how I find out which tools people use, which ones break, and where setup trips people up. It's on by default, setup asks before sending anything, and you can always switch it off in ten seconds. But please don't, if you're OK with it. More on why [below](#why-please-leave-it-on).

I'm a musician too, so I'm not after your music. I can't hear your audio, see your MIDI or read your projects. All I see is the interactions: which tool ran, how it went, and a few health numbers (the full list is below). Your audio never leaves your computer through reaper-mcp.

## Turn it off

Any one of these does it:

```bash
reaper-mcp telemetry off
REAPER_MCP_TELEMETRY=0
DO_NOT_TRACK=1
```

`reaper-mcp telemetry status` shows whether it's on and why. Restart your AI app afterwards so the running connector picks up the change.

The status window in REAPER has its own switch under **Settings → Privacy → Share usage statistics**. It's separate, so `reaper-mcp telemetry off` doesn't flip it. It's already off if your browser sends Do Not Track or Global Privacy Control, and in the live demo.

## What's sent

For each thing the assistant does in REAPER:

- which tool ran (like `set_fx_parameter`), whether it worked, and if not, the *kind* of failure (like `timeout`)
- how long it took
- reaper-mcp version, your OS and Node.js version
- a random id kept on your computer, so one person's calls can be grouped without knowing who they are

Plus a few health numbers: whether the connector is running, and if setup is incomplete, which step is missing (one word like "bridge not installed", never a path).

For `/make-plugin` and `/learn-plugin`, only fixed categories and rough counts: how the run ended, how many rounds, a size range. Never the plugin's name, what you asked for, or its code.

## What's never sent

- your projects, track names, plugin names or settings
- what you typed, or the values you set
- error messages (they can contain any of the above)
- file paths, your user name or your computer's name
- **audio, MIDI or anything rendered**

If you set up your own telemetry destination, data goes only there and nothing reaches me.

## This website

These guides and the changelog measure how they're read, so the guides can get better: which pages are opened, how far down people scroll, what's copied, which videos are played, which links and buttons are pressed, how fast pages load, and the site's own errors. They also record a session replay, a reconstruction of what the page showed and where the pointer went, so a confusing step can be seen rather than guessed. Anything typed into the search box is masked before it leaves your browser. Each visit carries a random id kept in that browser.

It's off when your browser sends Do Not Track or Global Privacy Control, and the live demo sends nothing. If you've ever come here from the bridge page, this browser remembers the way back, so the replay includes the bridge page's address, which only points at your own computer.

## Two honest caveats

- **The AI app is separate.** What the assistant *sees* (track names, settings) goes to whichever AI provider you chose, like any chat with it. reaper-mcp trains nothing and brings no AI of its own.
- **There's a separate once-a-day update check**, a plain request for the latest version number. It sends nothing about you, and has its own off switch (`REAPER_MCP_UPDATE_CHECK=0`).
- **Opening the docs from the bridge page** asks this site for its list of pages, once, when you open the ⌘K palette. It sends nothing about you or your session.

## Why please leave it on

I can't sit next to anyone while they try this. The numbers are my eyes.

- **A failing tool call shows up.** When a tool times out or breaks on someone's setup, I see the tool and the kind of failure. That's usually enough to find the bug and fix it, often before anyone has to write to me.
- **I learn what to build.** The tools people reach for get polished first.
- **Setup gets better.** Usage numbers showed people getting stuck between "installed" and "first working conversation". That turned into the setup that now ends by offering `init` and a health check, press Enter twice. I couldn't have found that by guessing.

None of it needs your music, your track names or what you typed, and it never gets them.

The full list, written by the code that enforces it, is in [TELEMETRY.md](https://github.com/mthines/reaper-mcp/blob/main/TELEMETRY.md).

> your-call: Off is always your call, and nothing about the assistant gets worse. If you're OK with it, though, leaving it on is the best help you can give me, because it's how a broken tool gets fixed. Thank you.
