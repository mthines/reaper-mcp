---
name: learn-plugin
description: Interview the user about a plugin and write it to their personal plugin memory for the mixing skills
---

# /learn-plugin

This skill interviews the user about a plugin they want the mixing skills to know
about, then writes a properly formatted knowledge file to the **plugin knowledge
base** at `~/.claude/knowledge/plugins/{vendor}/{plugin}.md`.

This is the *manual interview* path. The mixing skills also learn plugins **while
working** (capturing param maps, kept settings, and gotchas) per
`knowledge/reference/memory-protocol.md` — this skill is for when the user wants
to teach a plugin up front. To recall or maintain memory, use `/mix-memory`.

> **It's versioned.** For a cloned + symlinked install, `~/.claude/knowledge` is
> the repo, so the file lands in the working tree — remind the user to commit it to
> their fork (`git add knowledge/plugins/...`) so it ships to anyone who clones.

## Trigger

When the user types `/learn-plugin` or asks Claude to "learn about a plugin" or "add plugin knowledge".

## Instructions

### Step 1: Ask for the plugin name

Start the conversation:

> "What plugin would you like me to learn about? Tell me its name and what it does."

Wait for the user's response.

### Step 2: Gather required information

Ask these questions **one group at a time** (not all at once). Wait for each answer before proceeding.

**Group A — Identification:**
1. "What is the plugin's full name as it appears in REAPER's FX browser? Copy it exactly — for example: `VST3: Pro-Q 3 (FabFilter)` or `JS: ReaEQ (Cockos)`."
2. "Are there any other names or variations it shows up as? (e.g., different between VST2/VST3, or different on Windows vs Mac)"

**Group B — Categorization:**
3. "What category best describes this plugin?"
   - Present options: `eq`, `compressor`, `limiter`, `saturator`, `reverb`, `delay`, `gate`, `de-esser`, `amp-sim`, `channel-strip`, `analyzer`, `stereo-imager`, `multiband`, `pitch-correction`
4. "What is its character or style?" (optional)
   - Present options: `transparent`, `character`, `vintage`, `modern`, `surgical`
5. "Who makes it? (vendor name)"

**Group C — Usage:**
6. "On a scale of 1–100, how strongly do you prefer this plugin over alternatives for its category? (e.g., 85 = your go-to, 50 = use sometimes, 30 = only when nothing else available)"
7. "What are the most important parameters you adjust, and what do they do?"
8. "What are your typical settings for different use cases? For example: how do you set it up on vocals vs kick drum?"
9. "Are there any factory presets worth loading as starting points?"
10. "When do you reach for this plugin instead of its alternatives?"

### Step 3: Generate the knowledge file

Once you have all the answers, generate a knowledge file in this format:

```markdown
---
name: [full display name]
fx_match: ["[exact REAPER FX list name 1]", "[alternate name 2 if any]"]
category: [category]
style: [style if provided]
vendor: [vendor name]
preference: [preference score]
replaces: []
---

# [Plugin Name]

## What it does

[One paragraph describing the plugin based on user's description. Be specific about its sonic character and primary use cases.]

## Key parameters by name

[Table of parameters the user mentioned, with the exact names as they appear in the plugin UI]

| Parameter | Range | Description |
|-----------|-------|-------------|
[rows based on user input]

## Recommended settings

[One section per use case the user described]

### [Use case 1]

| Parameter | Value | Why |
|-----------|-------|-----|
[rows based on user input]

## Presets worth knowing

[Based on user's answer, or "No notable factory presets. Build from the recommended settings."]

## When to prefer this

[Based on user's answer about when they reach for it]

## Learned notes

<!-- Contextualized observations captured while working with this plugin.
     The mixing skills append here automatically per memory-protocol.md. -->
```

### Step 4: Determine the file path

- Ask the user: "What vendor slug should I use for the directory? For example, FabFilter would be `fabfilter`, Line 6 would be `line-6`."
- Suggest a slug if the vendor is obvious.
- Plugin slug: lowercase plugin name, spaces to hyphens, remove special characters.

Default target (personal layer):
`~/.claude/knowledge/plugins/{vendor-slug}/{plugin-slug}.md`

Example: FabFilter Pro-Q 3 → `~/.claude/knowledge/plugins/fabfilter/pro-q-3.md`

(Contributor-only: a plugin meant to ship for all users goes to the repo's
`knowledge/plugins/{vendor-slug}/{plugin-slug}.md` instead.)

### Step 5: Write the file

Create the directory if needed, then write the generated file:

```
mkdir -p ~/.claude/knowledge/plugins/{vendor-slug}
```

Write to `~/.claude/knowledge/plugins/{vendor-slug}/{plugin-slug}.md`. If a
personal file already exists, **merge** — don't clobber its `## Learned notes`.

### Step 6: Confirm

Tell the user:

> "Done! I've written `~/.claude/knowledge/plugins/{vendor}/{plugin}.md`.
>
> The mixing skills will now prefer **[Plugin Name]** for **[category]** tasks, and
> will keep refining it in `## Learned notes` as they work with it.
>
> You can edit the file directly. To teach another plugin, run `/learn-plugin`
> again; to recall or tidy memory, run `/mix-memory`."

## Notes

- Always use the **exact** FX name from REAPER's FX browser — this is critical for pattern matching
- If the user doesn't know the exact FX name, suggest they open REAPER, go to FX Browser, find the plugin, and copy the name
- The `preference` score determines which plugin wins when multiple options are available for the same category
- Do not add gray-matter or YAML library imports — the knowledge-loader parses frontmatter with a simple regex
- VST3 versions are preferred over VST2 when both exist (add both to fx_match)
- Files under `~/.claude/knowledge/plugins/` are read by the mixing skills via Read/Glob at runtime; the same tree (the repo's `knowledge/`) is what the `reaper-mix-agent` knowledge-loader bundles. Keep the frontmatter shape consistent so both readers work.
- If the user is unsure of parameters or good settings, research the web (`WebSearch`/`WebFetch`) to pre-fill, then confirm with them. The `/mixer` and `/mastering` skills do this automatically for unknown plugins (the bootstrap path in `memory-protocol.md`) — `/learn-plugin` is the human-in-the-loop version.
