---
title: Undo, snapshots and the pause button
nav: Undo and snapshots
summary: What happens if it gets something wrong, and the three ways to stop it or take it back.
section: safe
order: 1
---

The first worry is usually "what if it wrecks my project?". Here's what's in place, and where the limits are.

## Every change is one undo step

Each edit it makes is a single undo step in REAPER, labelled `MCP: …`. Press **Cmd/Ctrl+Z** and exactly that change goes away, the same as if you'd done it yourself. A multi-step change that fails half way undoes itself.

## Snapshots

Before a big task the mix skills save a **snapshot**: your levels, pans, plugin settings and sends. Restore it and you're back. They save another one afterwards, so you can flip between before and after and listen. Ask for one whenever you like:

> say: Save a snapshot called "before the chorus tweaks"

Snapshots aren't automatic for everything. If you give a raw instruction outside the mix skills, ask for a snapshot first.

## Read-only mode and the pause button

The status window next to REAPER has two switches:

- **Read-only.** It can listen, measure and advise, but not change anything. Great for "tell me what's wrong" questions. It stays on after you restart REAPER.
- **Pause.** Every request fails until you resume. One click, for when you'd rather it stopped *right now*.

`/critique` never changes anything either, whatever mode you're in.

## Things it won't do

It won't quit REAPER, close or open projects, or switch project tabs. It won't delete your master track. It refuses anything that would open a dialog box and freeze REAPER. It won't save over a never-saved project without a path.

## What isn't covered

Being straight about the edges:

- **Some things can't be undone.** Deleting a snapshot, render files that get replaced when you ask for "overwrite", the metronome toggle, and anything you save over your project file.
- **Saving after a bad edit** drops REAPER's undo history for it when you reopen the project.
- **Your AI app sees what comes back from REAPER**: track names, plugin settings, file paths. That goes to whichever AI provider you use. See [what's collected](telemetry.md).

## Habits that make it boring

1. **Save a copy** of a project that matters before a long session.
2. **Turn on read-only** when you only want advice.
3. **Ask for a dry run** of a big edit: it lists what it would do and flags conflicts before touching anything.
4. **Keep the status window open.** Pause is one click away.

> your-call: You can undo anything it does with one keystroke, so say "no, undo that" without feeling bad. It doesn't have feelings, and the undo history is free.
