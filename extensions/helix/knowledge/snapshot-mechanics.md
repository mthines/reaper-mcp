---
title: Snapshot Mechanics — Add, Edit, and Assign Per-Snapshot State
impact: HIGH
tags:
  - helix
  - snapshots
  - controllers
  - editing
---

# Snapshot Mechanics

How Helix's 8 snapshots are stored and how to edit them correctly.
A snapshot is **not** a copy of the whole preset — it stores only deltas: which blocks are bypassed, and the values of parameters assigned to the Snapshots controller.
Verified against real `.hlx` files.

## The three places snapshot state lives

1. **`tone.snapshotN.blocks.dspX`** = `{blockId: bool}` — per-snapshot **bypass state** of every block (`true` = on). This is how a snapshot turns blocks on/off (e.g. lead delay on, rhythm gate off).
2. **`tone.snapshotN.controllers.dspX.blockId.Param`** = `{"@value": <v>, "@fs_enabled": false}` — per-snapshot **value** of any parameter assigned to the Snapshots controller.
3. **`tone.controller.dspX.blockId.Param`** = `{"@min", "@max", "@controller": 9, "@snapshot_disable": false}` — the **declaration** that a parameter is snapshot-controllable. **`@controller: 9` is the Snapshots controller** (verified from a Helix Native export — assigning a parameter to Snapshots writes `9`, NOT `19`). Without this declaration the per-snapshot `@value`s are ignored and the parameter never moves. In the Helix UI an assigned parameter shows its value in **[brackets]** with a small controller icon.
4. **`tone.global.@current_snapshot`** = the active snapshot index (0–7) on load.
5. **`tone.dspX.blockId.@enabled`** = the block's **base bypass state**, which is the **load-time** state. NOT cosmetic — see the critical invariant below.

Snapshot metadata: `@name`, `@valid` (`true` if in use), `@ledcolor`, `@tempo`, `@pedalstate`.

## CRITICAL invariant: base `@enabled` must equal the boot snapshot's block state

This is the single most dangerous snapshot bug, because the file looks correct and still loads.

**On load, Helix takes each block's bypass from its base `tone.dspX.blockId.@enabled` — NOT from `snapshotN.blocks`.** The `snapshotN.blocks` map only re-applies when you *switch* snapshots; it does not override the base state on the initial load.

Therefore, for **every** block:

```
tone.dspX.blockId.@enabled  ==  tone.snapshot{@current_snapshot}.blocks.dspX.blockId
```

If you set all base `@enabled` to `true` but the boot snapshot wants some blocks off, **those blocks load enabled** — delay/reverb/pitch ring out over a tone that was supposed to be tight, even though `snapshotN.blocks` says `false`. Verified against five working presets: in each, every block's base `@enabled` exactly matches its state in the snapshot named by `@current_snapshot`.

**Rule when generating or editing any preset:** after building all snapshots, set each block's base `@enabled` from the boot snapshot:

```python
boot = tone["global"]["@current_snapshot"]
for dsp in ("dsp0", "dsp1"):
    for block_id, on in tone[f"snapshot{boot}"]["blocks"][dsp].items():
        tone[dsp][block_id]["@enabled"] = on   # base = boot snapshot's state
```

Assert it in the round-trip check:

```python
boot = t["global"]["@current_snapshot"]
for dsp in ("dsp0", "dsp1"):
    for b, on in t[f"snapshot{boot}"]["blocks"][dsp].items():
        assert t[dsp][b]["@enabled"] == on, f"{dsp}/{b} base @enabled != boot snapshot"
```

## Invariant: keep the controller declarations in sync

If a parameter has a per-snapshot `@value` in `snapshotN.controllers`, it **must** also be declared in the top-level `tone.controller` with `@controller: 9`.
And every block referenced in a snapshot's `blocks`/`controllers` must exist in `dspX`.
Breaking this invariant makes the snapshot ignore the value or fail to load cleanly.

## Task: change which blocks are on in a snapshot

Edit `tone.snapshotN.blocks.dspX[blockId]` to `true`/`false`.
Do this for each affected block and the same `blockId` keys used in `dspX`.

```jsonc
// Snapshot 1 = "Lead": turn the delay (block6) and TS boost (block4) ON
"snapshot1": { "@name": "Lead", "@valid": true,
  "blocks": { "dsp0": { "block6": true, "block4": true, "block7": true } } }
```

## Task: make a parameter change between snapshots

To have, say, amp `Drive` differ across snapshots:

1. **Declare it** in `tone.controller.dspX.blockId`:
   ```jsonc
   "controller": { "dsp0": { "block5": {
     "Drive": { "@min": 0, "@max": 1, "@controller": 9, "@snapshot_disable": false } } } }
   ```
   Use the parameter's real unit for `@min`/`@max` (normalized for amp knobs; dB/Hz/semitones for others — see [`parameter-encoding.md`](./parameter-encoding.md)).
2. **Set its value in each snapshot** under `tone.snapshotN.controllers.dspX.blockId`:
   ```jsonc
   "snapshot0": { "controllers": { "dsp0": { "block5": {
     "Drive": { "@value": 0.45, "@fs_enabled": false } } } } }
   "snapshot1": { "controllers": { "dsp0": { "block5": {
     "Drive": { "@value": 0.70, "@fs_enabled": false } } } } }
   ```
3. **Set the block's own `Drive` value in `dspX` equal to the boot snapshot's `@value`.** Like `@enabled`, the base parameter value is the **load-time** value — the snapshot `@value` only re-applies when you *switch* snapshots, so if the base disagrees with the boot snapshot the parameter loads at the wrong value. Verified from a Helix Native export (base `Drive` matched the current snapshot's `@value`). Same invariant as the base-`@enabled` rule above, applied to controller-assigned parameters.

## Task: add / enable a new snapshot

1. Set `snapshotN.@valid = true` and give it a `@name`.
2. Populate `snapshotN.blocks.dspX` with the bypass state you want for every block (copy the structure from an existing valid snapshot so all `blockId`s are present).
3. Populate `snapshotN.controllers.dspX` with `@value`s for every parameter that is declared in `tone.controller` (otherwise it inherits the previous snapshot's value unpredictably).
4. Optionally set `@ledcolor`, `@tempo`.
5. **After all snapshots are built, sync every block's base `@enabled` to the boot snapshot** (`tone.global.@current_snapshot`) — see the critical invariant above. Skipping this loads the wrong bypass states.

**Safest method:** copy an existing valid snapshot object wholesale, rename it, then flip the specific block bypasses and `@value`s you want. This guarantees every required key is present.

> When you change which snapshot boots (`@current_snapshot`), re-sync the base `@enabled` to the new boot snapshot.

## Task: rename or recolor a snapshot

Edit `snapshotN.@name` and `snapshotN.@ledcolor`. No other keys need touching.

## Common mistakes

- **Leaving base `@enabled = true` on blocks the boot snapshot turns off** → those blocks load enabled despite `snapshotN.blocks` saying `false`. This is the silent killer — see the critical invariant above. Always re-derive base `@enabled` from the boot snapshot after building snapshots.
- Setting `dspX.blockId.@enabled` to a value that does not match the boot snapshot, or expecting per-snapshot on/off to live *only* in `snapshotN.blocks`. Both matter: `@enabled` is the load-time state; `snapshotN.blocks` is what each snapshot switches to.
- Adding a `@value` in a snapshot without declaring the param in `tone.controller` → the value is ignored.
- Adding a snapshot with a sparse `blocks` map missing some `blockId`s → those blocks keep stale state. Copy a full snapshot instead.
- Forgetting `@valid: true` → the snapshot won't be selectable.
