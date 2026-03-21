# Knowledge Base

Audio engineering knowledge consumed by `reaper-mix-agent` at runtime. Markdown files with YAML frontmatter.

## File Organization

```
knowledge/
  plugins/{vendor-slug}/{plugin-slug}.md   # Plugin knowledge (fx_match, parameters, presets)
  genres/{genre-id}.md                      # Genre mixing conventions (targets, EQ, compression)
  workflows/{workflow-id}.md                # Step-by-step mixing workflows
  reference/{topic}.md                      # Reference material (frequencies, metering, etc.)
```

## How Files Are Loaded

`knowledge-loader.ts` in `reaper-mix-agent`:
- Recursively collects all `.md` files
- Categorizes by first path segment (`plugins/` → plugin, `genres/` → genre, etc.)
- Skips files with `_template` in the path
- Parses frontmatter with a simple line-by-line parser (NOT full YAML)

## Frontmatter Constraints

The parser is simple — respect these limitations:
- Arrays must be single-line: `fx_match: ["Pro-Q 3", "VST3: FabFilter Pro-Q 3"]`
- No multi-line values or nested objects
- `#` in frontmatter is treated as a comment — don't use in values
- Numbers parse automatically; booleans must be `true`/`false` (lowercase)

## Required Frontmatter by Type

### Plugins
| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `fx_match` | Yes | Array of strings for case-insensitive substring match against REAPER FX list |
| `category` | Yes | `eq`, `compressor`, `limiter`, `reverb`, `delay`, `gate`, etc. |
| `vendor` | Yes | Vendor name |
| `preference` | Yes | 0-100 score (stock: 30-50, third-party: 70-85, industry-standard: 85-95) |
| `style` | No | `transparent`, `character`, `vintage`, `modern`, `surgical` |
| `replaces` | No | Array of stock plugin IDs this replaces |

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

## fx_match Pattern Guide

Patterns are matched as case-insensitive substrings against REAPER's installed FX names:
- `"Pro-Q 3"` matches `"VST3: FabFilter Pro-Q 3 (FabFilter)"`, `"AU: Pro-Q 3"`, etc.
- Include multiple patterns for VST/VST3/AU variants if needed
- Check REAPER's FX Browser for exact names

## Coupled Code

Changes here may require updates in `apps/reaper-mix-agent/`:
- New knowledge type → update `typeFromPath()` in `knowledge-loader.ts`
- New frontmatter fields → update consumers in `agent.ts` or `plugin-resolver.ts`
- New workflow file → should have a matching mode in `modes/`
