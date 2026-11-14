---
title: Words you'll hear
nav: Glossary
summary: Plain-language explanations of the mixing terms and the AI terms you'll run into.
section: know
order: 3
---

Two kinds of words come up here: mixing ones and AI ones. You probably know half of each list. Here's the other half, in short.

## Mixing and REAPER

REAPER's own [User Guide](https://www.reaper.fm/userguide.php) has the long versions of these.

### Gain staging

Setting every track to a sensible level *before* adding plugins, so they get a signal they were designed for and nothing clips. The assistant aims for about -18 dBFS average.

### dB, dBFS and LUFS

dB measures level. 0 dB means unchanged, and roughly -10 dB *sounds* half as loud. dBFS is the digital ceiling, 0 dBFS being where it clips. LUFS measures how loud something sounds over time, and it's what streaming services use.

### True peak

The highest level the music reaches once it's converted back to sound. It can be higher than the highest sample, which is why mastering leaves a little room.

### Headroom

The gap between your loudest moment and the ceiling.

### FX chain

The plugins on a track, in order, top to bottom. Order changes the sound.

### EQ and compression

EQ turns frequencies up or down. A compressor makes loud parts quieter, so the level evens out.

### Folder track and bus

A folder track holds other tracks and works as a group: one fader and one set of plugins for all the drums. A bus is any track other tracks send audio to.

### Sends and sidechain

A send copies some of a track's audio to another track, like a reverb. A sidechain lets one track control a plugin on another, like a kick making the bass duck.

### Masking

When two sounds sit in the same frequency range and one hides the other.

### Stereo width and correlation

How wide something sounds. Correlation near +1 is mono-like, and near -1 means channels cancel each other.

### Snapshot

A saved copy of your mix state (levels, pans, plugin settings, sends) you can return to.

### Undo

Each change the assistant makes is one undo step, labelled `MCP: …`.

### Envelope and automation

A line that changes a setting over time, like a fader that rides down at the end of a chorus.

### Quantize

Snapping notes or hits to a grid, with a strength so it can keep some feel.

### Render

Writing the finished mix to a file.

### Stem

A group of tracks mixed down to one file, like "all the drums".

## The AI side

New to AI assistants? These are the words the setup guides use. None of them need a computer science degree.

### AI app

The program you chat with, like Claude Desktop, Claude Code, Codex, Gemini or Cursor. It does the thinking. On its own it can't touch REAPER. See [Set up your AI app](set-up-your-ai-app.md).

### Model

The AI itself, the part that reads what you write and decides what to do. Apps let you pick one. Bigger models are usually better at mixing decisions and slower.

### Prompt

What you type to the assistant. Plain words work. "The vocal is buried in the chorus" is a good prompt; you don't need special phrasing.

### MCP and connector

MCP (Model Context Protocol) is a standard way to plug tools into an AI app, a bit like a USB port. reaper-mcp is a connector that uses it: it gives the app hands inside REAPER.

### Tool and tool call

A tool is one thing the connector can do, like "read the meters on track 3" or "add an EQ". A tool call is the assistant using one. Your app shows them as it works, and may ask you to approve them.

### Permission prompt

The app asking "allow this?" before it uses a tool. You can approve once or always. It's the app's safety net, and you can keep it on.

### Skill and slash command

A skill is a written recipe the assistant follows, like how to balance a mix or master a song. You start one with a slash command: type `/mixer`, `/critique` or `/make-plugin`. You can also just ask, and the assistant picks the skill.

### Context

What the assistant can see right now: this chat, plus whatever it has read from REAPER. A very long chat can push early details out, so start a fresh chat for a new task.

### Token

The unit AI apps count text in, roughly three quarters of a word. Plans and usage limits are measured in tokens. A big project read in full uses more of them.

### Memory and LoreKit

An AI app forgets everything when a chat ends. LoreKit is a separate service that keeps notes between chats: your plugins, your taste, what worked. See [How it remembers](it-remembers.md).

### API key

A password-like code that lets one service talk to another, like the assistant reading your LoreKit notes. Treat it like a password, and never paste it into a chat.

### Hallucination

When an AI states something confidently that isn't true. reaper-mcp keeps this down by measuring instead of guessing, which is why it reads the meters before it judges a level.

### Terminal

The text window where you type commands, like `reaper-mcp setup`. On a Mac it's the app called Terminal. You only need it for the install.
