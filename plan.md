# REAPER MCP: MIDI & Media Editing Implementation Plan

## Overview

Extend the REAPER MCP server with two major new tool domains:

1. **MIDI Editing** — Create and edit MIDI items, notes, and CC envelopes (for piano, drums, synths)
2. **Media Item Editing** — Manage, split, stretch, trim, and manipulate audio/media items

This follows the existing 4-touch-point pattern: protocol types → response types → TypeScript tool file → Lua handler.

---

## Phase 1: MIDI Editing Tools (12 new tools)

### Tool Inventory

| Tool | Purpose | Key ReaScript APIs |
|------|---------|-------------------|
| `create_midi_item` | Create an empty MIDI item on a track at a position/length | `CreateNewMIDIItemInProj()` |
| `list_midi_items` | List all MIDI items on a track with positions/lengths | `CountTrackMediaItems()`, `GetMediaItemInfo_Value()`, `GetActiveTake()`, `TakeIsMIDI()` |
| `get_midi_notes` | Get all MIDI notes in an item (pitch, velocity, position, duration, channel) | `MIDI_CountEvts()`, `MIDI_GetNote()` |
| `insert_midi_note` | Insert a single MIDI note with pitch, velocity, start (beats), duration, channel | `MIDI_InsertNote()`, `MIDI_Sort()` |
| `insert_midi_notes` | Batch insert multiple MIDI notes (for chords, melodies, drum patterns) | `MIDI_InsertNote()` in loop, `MIDI_Sort()` |
| `edit_midi_note` | Edit an existing note's properties (pitch, velocity, position, duration) | `MIDI_SetNote()`, `MIDI_Sort()` |
| `delete_midi_note` | Delete a note by index | `MIDI_DeleteNote()`, `MIDI_Sort()` |
| `get_midi_cc` | Get CC events in a MIDI item (filter by CC number) | `MIDI_CountEvts()`, `MIDI_GetCC()` |
| `insert_midi_cc` | Insert a CC event (CC number, value, position, channel) | `MIDI_InsertCC()`, `MIDI_Sort()` |
| `delete_midi_cc` | Delete a CC event by index | `MIDI_DeleteCC()`, `MIDI_Sort()` |
| `set_midi_item_properties` | Set MIDI item properties (position, length, mute, loop) | `SetMediaItemInfo_Value()` |
| `get_midi_item_properties` | Get detailed MIDI item properties | `GetMediaItemInfo_Value()`, `MIDI_CountEvts()` |

### Position System — Critical Design Decision

MIDI note positions in REAPER are stored in **PPQ ticks** (pulses per quarter note, typically 960 PPQ). This is not human-friendly. The tool API will accept positions in **beats** (quarter notes from item start) and convert internally:

- **User-facing**: beats from item start (e.g., beat 0.0 = item start, beat 1.0 = one quarter note in)
- **Internal conversion**: `MIDI_GetPPQPosFromProjTime()` / `MIDI_GetProjTimeFromPPQPos()` for absolute positioning
- **For note durations**: beat fractions (e.g., 1.0 = quarter, 0.5 = eighth, 0.25 = sixteenth)

The Lua handler will convert beats → PPQ ticks using `960 * beats` (standard PPQ resolution).

### MIDI Note Conventions

- **Pitch**: MIDI note number 0-127 (60 = C4/Middle C). Tool description will include reference.
- **Velocity**: 0-127 (0 = note off, 1-127 = soft to hard)
- **Channel**: 0-15 (default 0)
- **Position**: beats from item start (float)
- **Duration**: beats (float, e.g., 0.25 = sixteenth, 0.5 = eighth, 1.0 = quarter, 2.0 = half, 4.0 = whole)

### Batch Insert Design

`insert_midi_notes` accepts an array of notes, enabling:
- **Melodies**: sequential notes with different pitches/timings
- **Chords**: multiple notes at the same position
- **Drum patterns**: notes on different pitches (drums map pitches to instruments)
- Returns count of notes inserted and total note count after insertion

---

## Phase 2: Media Item Editing Tools (10 new tools)

### Tool Inventory

| Tool | Purpose | Key ReaScript APIs |
|------|---------|-------------------|
| `list_media_items` | List all media items on a track (position, length, name, type, mute) | `CountTrackMediaItems()`, `GetTrackMediaItem()`, `GetMediaItemInfo_Value()` |
| `get_media_item_properties` | Detailed properties of a single item (position, length, rate, volume, fade, take info) | `GetMediaItemInfo_Value()`, `GetMediaItemTakeInfo_Value()` |
| `set_media_item_properties` | Set item properties: position, length, volume, mute, fade in/out, playrate | `SetMediaItemInfo_Value()` |
| `split_media_item` | Split an item at a time position (seconds), returns the two resulting items | `SplitMediaItem()` |
| `delete_media_item` | Delete a media item from the project | `DeleteTrackMediaItem()` |
| `move_media_item` | Move an item to a new position and/or track | `SetMediaItemInfo_Value("D_POSITION")`, `MoveMediaItemToTrack()` |
| `trim_media_item` | Trim item edges (adjust start offset and/or length) | `SetMediaItemInfo_Value("D_POSITION", "D_LENGTH", "D_SNAPOFFSET")`, take `D_STARTOFFS` |
| `add_stretch_marker` | Add a stretch marker at a position within an item | `SetTakeStretchMarker()` |
| `get_stretch_markers` | List all stretch markers in an item | `GetTakeStretchMarker()`, `GetTakeNumStretchMarkers()` |
| `delete_stretch_marker` | Remove a stretch marker by index | `DeleteTakeStretchMarker()` |

### Media Item Identification

Items are identified by `trackIndex` + `itemIndex` (0-based position on track). This matches the existing convention for track/FX indexing. The Lua handler resolves via `reaper.GetTrackMediaItem(track, itemIndex)`.

### Stretch Marker Design

Stretch markers allow time-stretching portions of audio to align with the grid:
- `position`: position within the item in seconds (from item start)
- `sourcePosition`: position in the source audio in seconds
- Moving a stretch marker's position while keeping sourcePosition fixed stretches/compresses audio

---

## Phase 3: Protocol Types

### New Command Types (22 total new)

Add to `CommandType` union in `libs/protocol/src/commands.ts`:

```
MIDI:
  'create_midi_item' | 'list_midi_items' | 'get_midi_notes' |
  'insert_midi_note' | 'insert_midi_notes' | 'edit_midi_note' |
  'delete_midi_note' | 'get_midi_cc' | 'insert_midi_cc' |
  'delete_midi_cc' | 'set_midi_item_properties' | 'get_midi_item_properties'

Media:
  'list_media_items' | 'get_media_item_properties' | 'set_media_item_properties' |
  'split_media_item' | 'delete_media_item' | 'move_media_item' |
  'trim_media_item' | 'add_stretch_marker' | 'get_stretch_markers' |
  'delete_stretch_marker'
```

### New Param Interfaces (22)

Each command gets a corresponding params interface with `z.coerce.number()` for all numeric fields.

### New Response Interfaces

```typescript
// MIDI
MidiItemInfo        // itemIndex, position, length, noteCount, ccCount, channel, muted
MidiNoteInfo        // noteIndex, pitch, velocity, startPosition (beats), duration (beats), channel, selected, muted
MidiCCInfo          // ccIndex, ccNumber, value, position (beats), channel
MidiItemProperties  // full details: MidiItemInfo + notes summary, tempo info

// Media
MediaItemInfo       // itemIndex, position, length, name, volume, muted, fadeIn, fadeOut, playRate, isMidi, takeName, sourceFile
StretchMarkerInfo   // index, position, sourcePosition
```

---

## Phase 4: Implementation Steps (Ordered)

### Step 1: Protocol types
- Add 22 command types to `CommandType` union
- Add 22 param interfaces
- Add 6 response interfaces
- Update `index.ts` exports

### Step 2: MIDI tool file (`tools/midi.ts`)
- `registerMidiTools(server: McpServer)`
- 12 tool registrations following the standard pattern
- All numeric params use `z.coerce.number()`
- `insert_midi_notes` accepts stringified JSON array of notes (MCP limitation — no nested arrays in schemas, so pass as JSON string and parse)

### Step 3: Media tool file (`tools/media.ts`)
- `registerMediaTools(server: McpServer)`
- 10 tool registrations following the standard pattern

### Step 4: Register in server.ts
- Import and call `registerMidiTools(server)` and `registerMediaTools(server)`

### Step 5: Lua MIDI handlers in `mcp_bridge.lua`
- 12 new handler functions in the `handlers` table
- Key implementation details:
  - `create_midi_item`: Use `reaper.CreateNewMIDIItemInProj(track, startPos, endPos)`
  - `insert_midi_note`: Use `reaper.MIDI_InsertNote(take, selected, muted, startPPQ, endPPQ, channel, pitch, velocity)` then `reaper.MIDI_Sort(take)`
  - `insert_midi_notes`: Loop through notes array, insert each, sort once at end
  - `get_midi_notes`: Use `reaper.MIDI_CountEvts(take)` to get count, then `reaper.MIDI_GetNote(take, i)` for each
  - Beat-to-PPQ conversion: `ppq = beats * 960` (REAPER default PPQ resolution)
  - PPQ-to-beat conversion: `beats = ppq / 960`
  - Always call `reaper.MIDI_Sort(take)` after inserts/edits
  - Always call `reaper.UpdateArrange()` after visible changes

### Step 6: Lua media handlers in `mcp_bridge.lua`
- 10 new handler functions
- Key implementation details:
  - `split_media_item`: `reaper.SplitMediaItem(item, position)` returns new right-side item
  - `add_stretch_marker`: `reaper.SetTakeStretchMarker(take, -1, position, sourcePosition)` — index -1 = add new
  - `move_media_item`: if changing tracks, use `reaper.MoveMediaItemToTrack(item, destTrack)`
  - `list_media_items`: iterate `CountTrackMediaItems()`, check `TakeIsMIDI()` to tag type
  - Always call `reaper.UpdateArrange()` after changes

### Step 7: Tests
- `tools/midi.test.ts` — test all 12 tools (mock sendCommand)
- `tools/media.test.ts` — test all 10 tools (mock sendCommand)
- Follow exact patterns from existing `transport.test.ts`

### Step 8: Build & lint verification
- `pnpm nx run-many --target=build,lint,test`

---

## Robustness Considerations

### Error Handling
- **Track validation**: Every handler checks track exists before proceeding
- **Item validation**: Every handler checks item exists and index is in range
- **Take validation**: MIDI operations verify take exists and is MIDI (`TakeIsMIDI()`)
- **Note index validation**: Edit/delete verify note index is valid via `MIDI_CountEvts()`
- **Position validation**: Ensure positions are non-negative
- **Pitch/velocity clamping**: Clamp to 0-127 range in Lua handler (defensive)

### Undo Integration
- Wrap mutating operations in `reaper.Undo_BeginBlock()` / `reaper.Undo_EndBlock()`
- This lets users Ctrl+Z to undo any AI-made changes
- Undo descriptions will be descriptive (e.g., "MCP: Insert MIDI note C4")

### Arrangement Update
- Call `reaper.UpdateArrange()` after any visual change
- Call `reaper.MarkProjectDirty(0)` to ensure project shows as modified

### JSON Array Handling for Batch Operations
- The Lua JSON parser's fallback mode doesn't handle arrays well
- For `insert_midi_notes`, the notes array will be encoded as a JSON string within params
- The Lua handler will parse it using the json_decode function (CF_Json_Parse handles arrays properly)
- Add a Lua helper `json_decode_array()` as fallback for the pattern-matching parser

---

## File Changes Summary

| File | Action | Changes |
|------|--------|---------|
| `libs/protocol/src/commands.ts` | Edit | Add 22 command types + 22 param interfaces |
| `libs/protocol/src/responses.ts` | Edit | Add 6 response interfaces |
| `libs/protocol/src/index.ts` | Edit | Export new types |
| `apps/reaper-mcp-server/src/tools/midi.ts` | **New** | 12 MIDI tools |
| `apps/reaper-mcp-server/src/tools/media.ts` | **New** | 10 media tools |
| `apps/reaper-mcp-server/src/tools/midi.test.ts` | **New** | MIDI tool tests |
| `apps/reaper-mcp-server/src/tools/media.test.ts` | **New** | Media tool tests |
| `apps/reaper-mcp-server/src/server.ts` | Edit | Register new tool modules |
| `reaper/mcp_bridge.lua` | Edit | Add 22 Lua handlers |
| `CLAUDE.md` | Edit | Update tool table with new tools |
