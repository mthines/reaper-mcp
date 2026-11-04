---
title: Helix Preset JSON Format — Reverse-Engineered Spec
impact: HIGH
tags:
  - helix
  - format
  - json
  - hlx
  - schema
---

# Helix Preset JSON Format

The on-disk `.hlx` preset format, reverse-engineered from real Helix Native 3.x exports.
There is **no official Line 6 schema** — this spec is derived from inspecting real preset files and corroborated by community parsers.
Every structural claim below was verified against actual `.hlx` files unless tagged otherwise.

## Contents

- [File facts](#file-facts)
- [Top-level wrapper](#top-level-wrapper)
- [`data.tone` keys](#datatone-keys)
- [DSP paths and blocks](#dsp-paths-and-blocks)
- [A block object](#a-block-object)
- [Routing: split and join](#routing-split-and-join)
- [Input block (built-in gate)](#input-block-built-in-gate)
- [Cab / IR blocks](#cab--ir-blocks)
- [Snapshots](#snapshots)
- [Controllers and footswitches](#controllers-and-footswitches)
- [Global object](#global-object)
- [IR UUID table](#ir-uuid-table)
- [Container formats](#container-formats)
- [Confidence map](#confidence-map)

## File facts

- Single preset = **`.hlx`**, a **plain-text UTF-8 JSON document** (not zipped, not binary). Editable in a text editor; `json.load()` parses it directly. (HIGH)
- Setlist = `.hls`, bundle = `.hlb` — both wrap their payload in an `encoded_data` key that is **Base64-then-zlib-compressed** JSON. (HIGH — community parsers)
- Full hardware backup = `.hxb` — **proprietary binary** with an `AF6L` signature. Do not hand-edit. (HIGH)
- This skill works on single **`.hlx`** files. To touch a preset inside a `.hls`/`.hlb`, extract it first (see container formats).

## Top-level wrapper

```json
{
  "data": { "meta": {...}, "device": 2162944, "tone": {...}, "device_version": 57737216 },
  "meta": { "original": 0, "pbn": 0, "premium": 0 },
  "schema": "L6Preset",
  "version": 6
}
```

- `version`: integer `6`. `schema`: `"L6Preset"`. (HIGH)
- `meta` (top-level, NOT `data.meta`): `{original, pbn, premium}` — sharing/marketplace flags; leave as found. (HIGH)
- `data.device`: integer device id (e.g. `2162944`). `data.device_version`: firmware/app version int (e.g. `57737216`). Preserve both as found unless deliberately retargeting hardware. (HIGH)
- `data.meta`: `{name, application, build_sha, modifieddate, appversion}`.
  - `name` — the preset name shown in Helix. **Edit this when creating/renaming.** (HIGH)
  - `application` — e.g. `"Helix Native"`. `appversion` — int matching `device_version`. `modifieddate` — Unix epoch seconds. `build_sha` — often empty string. (HIGH)

## `data.tone` keys

`data.tone` holds the entire signal chain:

| Key | Meaning |
| --- | --- |
| `dsp0`, `dsp1` | The two DSP paths (chips). Each holds the blocks, inputs, outputs, split, join. |
| `snapshot0` … `snapshot7` | The 8 snapshots. |
| `controller` | Top-level controller/footswitch **assignments** (which params are assignable, their ranges). |
| `footswitch` | Footswitch **labels and assignments** per block. |
| `global` | Tempo, active snapshot, routing topology, input impedance, etc. |
| `variax`, `dtdual`, `dt0`, `dt1` | Variax guitar + DT-amp integration settings. Preserve as found unless asked. |
| `powercab*` | Powercab speaker settings. Preserve as found. |
| `irUuidTable` | Maps IR slot numbers (`000`–`127`) to user-IR UUIDs. |

## DSP paths and blocks

Each `dspN` object contains:

```
dsp0 {
  inputA, inputB        // path inputs (inputA carries the built-in gate)
  outputA, outputB      // path outputs
  split, join           // parallel-routing nodes (present when the path splits)
  block0 … blockN       // effect / amp / cab / IR blocks (key name is arbitrary; order is by @position)
  cab0                  // legacy cab key seen in some presets
}
```

- **Block key names (`block0`, `block5`, …) are NOT the chain order.** They are stable identity handles. The chain order is the integer `@position`. Always sort blocks by `@position` to reconstruct the chain. (HIGH — `block10` can sit at `@position 7`.)
- A path holds up to ~8 processing blocks (DSP-budget-limited; HX Stomp allows fewer). (MEDIUM)
- `@path` on each block (0 or 1) says which side of a split the block sits on.

## A block object

Verbatim shape of an amp block (`HD2_AmpPVPanama`):

```json
"block5": {
  "@model": "HD2_AmpPVPanama",
  "@position": 5,
  "@path": 0,
  "@type": 1,
  "@enabled": true,
  "@bypassvolume": 1,
  "@no_snapshot_bypass": false,
  "Resonance": 0.6499999761581421,
  "Mid": 0.550000011920929,
  "Bass": 0.6499999761581421,
  "Treble": 0.3499999940395355,
  "Master": 0.46000000834465027,
  "Drive": 0
}
```

Key meanings:

| Key | Meaning |
| --- | --- |
| `@model` | Model identifier string. See [`model-catalog.md`](./model-catalog.md). Never hand-invent — copy from a real preset. |
| `@position` | Integer chain position. Lower = earlier. **This is the order, not the block key.** |
| `@path` | Which split path (0/1) the block is on. |
| `@enabled` | **Bypass state.** `true` = active, `false` = bypassed. The bypass key is `@enabled`, NOT `@bypass`. |
| `@type` | Block type/category int (0 = effect, 1 = amp, 2 = cab, …). Preserve as found. |
| `@stereo` | Boolean (present on some blocks). |
| `@bypassvolume`, `@no_snapshot_bypass` | Bypass behavior flags. Preserve as found. |
| Named keys (`Mid`, `Gain`, `LowCut`, …) | Parameter values. **Names are model-specific** — see [`model-catalog.md`](./model-catalog.md). **Encoding is mixed** — see [`../rules/parameter-encoding.md`](../rules/parameter-encoding.md). |

## Routing: split and join

```json
"split": { "@model": "HD2_AppDSPFlowSplitY", "@position": 7, "@enabled": true, "bypass": false,
           "BalanceA": 0.5, "BalanceB": 0.5 },
"join":  { "@model": "HD2_AppDSPFlowJoin", "@position": 8, "@enabled": true,
           "A Level": 0, "A Pan": 0.5, "B Level": 0, "B Pan": 0.5, "B Polarity": false, "Level": 0 }
```

- Split models seen: `HD2_AppDSPFlowSplitY` (Y split, `BalanceA`/`BalanceB`), `HD2_AppDSPFlowSplitAB` (A/B split, `RouteTo`). (HIGH)
- Parallel routing = a `split` followed by blocks on `@path 0` and `@path 1`, merged at `join`. `global.@topology0/@topology1` encodes the path shape (e.g. `"SAB"`, `"SABJ"` — Serial / split-A-B / split-A-B-Join). (MEDIUM — exact topology grammar not fully reverse-engineered.)
- For reliable parallel routing, **clone the split/join nodes from a real preset that already has the topology you want** rather than synthesizing them.

## Serial routing: Path 1 → Path 2

`dsp0` and `dsp1` are the two DSP paths.
To run them **in series** (Path 1 feeds Path 2 — the standard way to offload post-FX onto the second processor when Path 1 is DSP-full), the path inputs/outputs are wired by their `@output` / `@input` integer codes, **not** by a split/join:

```json
// dsp0 (Path 1): send the path output INTO Path 2
"outputA": { "@model": "HD2_AppDSPFlowOutput", "@output": 2, "pan": 0.5, "gain": 0 },
"outputB": { "@model": "HD2_AppDSPFlowOutput", "@output": 0, "pan": 0.5, "gain": 0 },

// dsp1 (Path 2): receive from Path 1, send to the main out
"inputA":  { "@input": 0, "@model": "HD2_AppDSPFlow1Input", "noiseGate": false, "decay": 0.5, "threshold": -48 },
"outputA": { "@model": "HD2_AppDSPFlowOutput", "@output": 1, "pan": 0.5, "gain": 0 }
```

- `dsp0.outputA.@output = 2` routes Path 1 into Path 2 (instead of `1` = straight to the main out — the single-path default). (HIGH — verified by repair.)
- `dsp1.inputA.@input = 0` receives Path 1's output; `dsp1.outputA.@output = 1` sends Path 2 to the main out. (HIGH)
- Each path still has its own `split` (position 0) and `join`; place the path's processing blocks between them on `@path 0`. For a clean serial wet chain on Path 2, use `HD2_AppDSPFlowSplitAB` with `RouteTo: 0` (all signal down path A). (HIGH)
- **Get these `@output` / `@input` codes by cloning a real two-path preset** (e.g. one with an amp on `dsp0` and delay/reverb on `dsp1`) rather than guessing the integers — `@output` semantics beyond `1` = main and `2` = Path 2 are not fully decoded. (HIGH)
- When you split a chain across both paths, **snapshot `blocks` and `controllers` must list both `dsp0` and `dsp1`**, and the top-level `controller` declarations span both — see [`../rules/snapshot-mechanics.md`](../rules/snapshot-mechanics.md).

## Input block (built-in gate)

```json
"inputA": { "@input": 1, "@model": "HD2_AppDSPFlow1Input",
            "noiseGate": true, "decay": 0.0099999, "threshold": -68 }
```

The path input carries an **always-available noise gate** (separate from a Gate block): `noiseGate` (bool), `threshold` (dB), `decay` (0–1 normalized). (HIGH)

## Cab / IR blocks

- **Mic'd cab** (`HD2_CabMicIr_*`): `Mic` (int index), `Position` (0 = center … real-unit scale), `Distance` (real units), `Angle` (degrees, 0–45), `LowCut`/`HighCut` (Hz), `Level` (dB). Dual cabs add `Pan`, `Delay`. (HIGH)
- **Legacy cab** (`HD2_Cab*`): `Distance`, `EarlyReflections`, `HighCut`/`LowCut` (Hz), `Level`. (HIGH)
- **IR block** (`HD2_ImpulseResponse1024` / `...1024Dual`): `Index` (IR slot number → see `irUuidTable`), `LowCut`/`HighCut` (Hz), `Mix`, `Level`; dual adds `A/B Pan`, `A/B Polarity`, `Delay`. (HIGH)

## Snapshots

Helix presets have **8 snapshots** (`snapshot0`…`snapshot7`). A snapshot stores the deltas — which blocks are on/off and the values of snapshot-assigned parameters. See [`../rules/snapshot-mechanics.md`](../rules/snapshot-mechanics.md) for the full edit procedure.

```json
"snapshot0": {
  "@name": "Channel 1",
  "@tempo": 120,
  "@valid": true,
  "@pedalstate": 2,
  "@ledcolor": 1,
  "blocks":      { "dsp0": { "block7": true, "block4": false, "split": true, ... },
                   "dsp1": { "block3": false, ... } },
  "controllers": { "dsp0": { "block1": { "Threshold": { "@value": -39, "@fs_enabled": false } } } }
}
```

- `@name` — snapshot label. `@valid` — `true` if the snapshot is in use. `@ledcolor` — LED color index. `@pedalstate`, `@tempo` — per-snapshot pedal/tempo. (HIGH)
- `blocks.dspX` = `{blockId: bool}` — the **per-snapshot bypass state** of every block (and `split`). `true` = on. A snapshot switches blocks on/off when you *select* it. (HIGH)
- **On load, the bypass state comes from each block's base `tone.dspX.blockId.@enabled`, not from `snapshotN.blocks`.** The base `@enabled` MUST equal the boot snapshot's (`global.@current_snapshot`) block state, or blocks load in the wrong state. This is the most common silent snapshot bug — see [`../rules/snapshot-mechanics.md`](../rules/snapshot-mechanics.md#critical-invariant-base-enabled-must-equal-the-boot-snapshots-block-state). (HIGH — verified by repair against five working presets.)
- `controllers.dspX.blockId.Param` = `{"@value": <v>, "@fs_enabled": false}` — the **per-snapshot value** of any parameter assigned to the Snapshots controller. `@value` uses the same mixed encoding as the block params. (HIGH)

## Controllers and footswitches

Top-level `tone.controller` declares which params are **assignable** and their controlled range:

```json
"controller": { "dsp0": { "block1": {
  "Threshold": { "@min": -60, "@max": 0, "@controller": 9, "@snapshot_disable": false },
  "Level":     { "@min": 5, "@max": 15.5, "@controller": 13,
                 "@fs_enabled": false, "@fs_label": "Level", "@fs_customlabel": "Pre Boost",
                 "@fs_ledcolor": 462860, "@fs_customcolor": 1, "@fs_momentary": false } } } }
```

- `@controller` = controller-source id. **`@controller: 9` = the Snapshots controller** (param value follows the active snapshot). Other ids = expression pedals / footswitches / MIDI. (HIGH — verified from a Helix Native export: assigning a parameter to Snapshots writes `9`. Older presets may show `19`; on the current firmware `9` is what works.)
- `@min` / `@max` = the controlled range (real units, e.g. dB / semitones).
- `@snapshot_disable` = exclude this assignment from snapshot recall.
- Footswitch metadata on the assignment: `@fs_label`, `@fs_customlabel`, `@fs_ledcolor`, `@fs_customcolor`, `@fs_momentary`.

Top-level `tone.footswitch` maps blocks to physical footswitches:

```json
"footswitch": { "dsp0": { "block4": {
  "@fs_index": 10, "@fs_enabled": false, "@fs_label": "Scream 808",
  "@fs_customlabel": "Tube Screamer", "@fs_ledcolor": 525824,
  "@fs_customcolor": 6, "@fs_momentary": false } } }
```

- `@fs_index` = footswitch number. `@fs_enabled` = assigned. `@fs_label` = default label, `@fs_customlabel` = user override. (MEDIUM)

## Global object

```json
"global": { "@model": "@global_params", "@tempo": 120, "@current_snapshot": 0,
            "@topology0": "SAB", "@topology1": "SABJ", "@cursor_dsp": 1,
            "@cursor_group": "block0", "@guitarinputZ": 8, "@guitarpad": 0, ... }
```

- `@current_snapshot` — the active snapshot index on load (0–7). (HIGH)
- `@tempo` — preset BPM (drives tempo-synced delays/mods). (HIGH)
- `@topology0/1` — routing topology per DSP. (MEDIUM)
- `@guitarinputZ` — input impedance setting. Preserve unless asked. (MEDIUM)

## IR UUID table

`tone.irUuidTable` maps zero-padded slot numbers (`"000"`–`"127"`) to user-IR UUID strings.
A block's IR `Index` parameter references a slot here.
**UUIDs point to IR files in the user's library** — if you set an `Index`, the target machine must have that IR imported, or the slot resolves to silence/default. Preserve the table as found; do not invent UUIDs. (HIGH)

## Container formats

- **Extract a preset from a `.hls`/`.hlb`:** decode `encoded_data` with `base64.b64decode()` then `zlib.decompress()`, parse the resulting JSON, pull the target preset object, and write it as a standalone `.hlx` with the `{version, schema, meta, data}` wrapper. (HIGH — community parser pattern.)
- **Do not** attempt to edit `.hxb` binary backups.

## Confidence map

| Area | Confidence | Basis |
| --- | --- | --- |
| Wrapper, `data.tone` keys, block shape, `@enabled` bypass | HIGH | Direct inspection of 9 real presets |
| Snapshot `blocks`/`controllers` mechanics | HIGH | Direct inspection (values cross-checked) |
| Mixed parameter encoding | HIGH | Direct inspection across amp/cab/EQ/gate |
| Controller id 9 = Snapshots | HIGH | Verified from a Helix Native export (assigning a param writes 9) |
| `@topology` grammar, split/join math | MEDIUM | Keys confirmed; full semantics not decoded |
| Container `.hls`/`.hlb` base64+zlib | HIGH | Community parsers (jyanes83, helix-py-api) |
