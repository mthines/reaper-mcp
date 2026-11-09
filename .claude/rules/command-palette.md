# Command palette and keyboard shortcuts (bridge page)

Same convention as LoreKit web (its `command-coverage` skill): ⌘K opens a palette, `g` then a letter navigates, a single letter acts. Code: `apps/bridge-ui/src/features/command/`.

## The rule

- **Every view and every real action gets a palette entry.** That is the floor; a missing entry is always a gap.
- **A shortcut is earned.** Add one only when the action is frequent, global to its screen, and flow-critical. Occasional things (settings toggles, timeline range, links, plugin filters, rename) stay palette-only.
- **Never put a bare key on a destructive action** (clear the log, delete a snapshot). The palette entry may only open the inline confirm.
- **`g` is navigation only.** Never bind an action to `g` + letter.
- Single-letter shortcuts never fire while typing in an input, textarea or contenteditable (the provider enforces it); ⌘K always does.

## How to add one

`useCommand({ id, label, group, shortcut, onSelect }, enabled)` from `features/command`. Register next to the state the action changes (the view owns its own commands: `LogCommands`, `PluginsCommands`, `SnapshotCommands`; `app/AppCommands.tsx` holds the page-level ones). Rules:

- A stable hook position: **never in a loop or `.map()`**. Wrap each item in a component that calls it once (`GoCommand`, `LoadCommand`). The React Compiler rejects a component with a disabled hooks lint rule.
- `enabled` is false when the action doesn't apply (no errors filter outside Calls, no Rebuild unless it is offered), so the palette lists only what works now.
- `contextual: true` on every command that belongs to one view (set it on all of a view's commands). The palette lists the page's groups first and ranks its commands first in a search, so Snapshots' commands lead on Snapshots.
- `children: Command[]` makes a drill-in level ("Rename a snapshot…").
- `hint` shows a key the command doesn't own (Shift+1–9 loads snapshots; that handler stays in `SnapshotsView`).
- `description` is searched, not drawn. Ids: `go-*`, `calls-*`, `snapshots-*`, `plugins-*`, `changelog-*`, `bridge-*`, `page-*`, `help-*`.
- The `?` sheet and the palette both read the live registry: a new command shows in both with nothing else to edit.

## Bindings in use (never reuse)

| Keys | Does |
| --- | --- |
| `mod+k` | Command palette |
| `?` | Keyboard shortcuts sheet |
| `g c` / `g t` / `g a` / `g p` / `g s` | Go to Calls / Tools / Sessions (agents) / Plugins / Snapshots |
| `/` | Focus search |
| `f` | Calls: errors only (toggle) |
| `p` | Calls: pause / resume the log |
| `j` / `k` | Calls: next / previous call |
| `c` | Snapshots: save the current mix |
| `Esc` | Close details, then clear the timeline selection, then the search |
| `↑` / `↓` | Step through rows with details open (handled by the view) |
| `Shift+1`–`9` | Load snapshot 1–9 (handled by `SnapshotsView`) |

Free letters stay free until a new frequent action needs one; check this table first.

## Tests

`CommandPalette.test.stories.tsx` and `shortcut.test.ts` cover the engine. A new view adds a story that presses its keys; assert what the viewer sees (the row, the state), never the registry.
