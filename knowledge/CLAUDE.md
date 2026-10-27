# Knowledge Base

Curated audio engineering knowledge read on demand by the mix skills (`/mixer`,
`/mastering`, `/critique`, …). Symlinked into `~/.claude/knowledge` by
`scripts/sync-symlinks.sh`. Markdown files with YAML frontmatter.

## File Organization

```
knowledge/
  genres/{genre-id}.md         # Genre mixing conventions (targets, EQ, compression)
  workflows/{workflow-id}.md   # Step-by-step mixing workflows
  reference/{topic}.md         # Reference material (frequencies, metering, memory-protocol, etc.)
```

**Plugin knowledge is not here.** It lives in LoreKit (scope `project::reaper-mcp`)
together with the skills' process lessons, as a read-only built-in layer
(`plugins::<vendor>/<plugin>`, curated in the `reaper-mcp` org) plus each user's own
layer on top (`user::plugins::<vendor>/<plugin>`) — see `reference/memory-protocol.md` for the record shape, tags
and how the skills look plugins up. Teach a plugin with `/learn-plugin`.

## Frontmatter

Keep it simple and flat — single-line values, single-line arrays
(`lufs_target: [-13, -10]`), lowercase `true`/`false`, no `#` in values.

### Genres
| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Genre display name |
| `id` | Yes | Must match filename (e.g., `rock.md` → `id: rock`) |
| `lufs_target` | Yes | Array `[-13, -10]` for min/max LUFS |
| `true_peak` | Yes | dBTP ceiling (e.g., `-1.0`) |
| `parent` | No | Inherits from parent genre |

### Workflows
| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Workflow display name |
| `id` | Yes | Must match filename |

New workflow files should be added to the workflow list in
`.claude/skills/mixer/SKILL.md` so the mixer can map a request to them.
