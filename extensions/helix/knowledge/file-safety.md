---
title: File Safety — Back Up, Round-Trip, Preserve Unknown Keys
impact: HIGH
tags:
  - helix
  - safety
  - validation
  - files
---

# File Safety

Rules for reading and writing real `.hlx` files without corrupting the user's library.
A malformed preset can fail to load in Helix or load with silent defaults — both waste the user's time.

## Before editing any existing preset

1. **Confirm the target path** with the user if ambiguous. Preset libraries hold many files with terse names.
2. **Back up first.** Copy the original to `<name>.hlx.bak` (or a timestamped copy) before writing. Never overwrite the only copy.
3. **Parse to confirm it is valid JSON** before trusting any edit. If `json.load()` fails, stop and report — do not attempt a text patch.

## Clone-then-edit is the default authoring path

The most reliable way to create a new preset is to **copy a real preset that is structurally close to the target** (right routing topology, right block types) and edit it — rather than synthesizing a preset object from scratch.
Synthesized presets miss device-specific keys (`device`, `device_version`, `variax`, `dt*`, `powercab*`, `irUuidTable`) that Helix expects.
The user's library (see [`../references/genre-recipes.md`](../references/genre-recipes.md)) and freshly exported Helix Native presets are good donors.

## Preserve unknown keys

When editing, **load the full JSON, mutate only the keys you intend to change, and write the whole object back.**
Do not strip keys you do not recognize (`@bypassvolume`, `@no_snapshot_bypass`, `variax`, `dtdual`, `@guitarinputZ`, etc.) — Helix reads them, and dropping them changes behavior or breaks loading.

```python
import json, shutil
src = "/path/Preset.hlx"
shutil.copy(src, src + ".bak")          # back up
d = json.load(open(src))                # full load
d["data"]["meta"]["name"] = "New Name"  # mutate only what you mean to
d["data"]["tone"]["dsp0"]["block5"]["Drive"] = 0.62
json.dump(d, open(src, "w"))            # write whole object back
```

## Validate the round-trip

After writing, re-parse the file and assert the change landed and nothing else broke:

```python
e = json.load(open(src))                # must not raise
assert e["schema"] == "L6Preset" and e["version"] == 6
assert e["data"]["tone"]["dsp0"]["block5"]["Drive"] == 0.62
```

If the re-parse raises, restore from the `.bak` and report.

## Naming and output location

- New presets: write to the same directory as the donor unless the user specifies otherwise, with a clear `name` in `data.meta.name` **and** a matching filename.
- `data.meta.name` is what Helix shows; the filename is what the OS shows. Keep them consistent to avoid confusion.
- Update `data.meta.modifieddate` to the current Unix epoch when saving a deliberate edit (optional but tidy).

## Hardware retargeting caveat

`data.device` and `data.device_version` identify the originating device/firmware.
A `.hlx` exported from Helix Native generally imports into Helix hardware and HX Stomp, but:

- Block counts may exceed a smaller device's DSP budget (HX Stomp) — the extra blocks may not load. Warn the user.
- A preset using models newer than the target's firmware will not load those models.
- Do not rewrite `device`/`device_version` to "convert" a preset — let Helix handle import. Just warn about budget/model mismatches.

## Never

- Never edit `.hxb` binary backups as text.
- Never invent `irUuidTable` UUIDs or model IDs.
- Never write a preset without having parsed the donor/original successfully first.
