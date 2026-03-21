# Reaper Mix Agent

AI mix engineer agent that loads audio engineering knowledge and builds context-aware system prompts for Claude.

## Commands

```bash
pnpm nx build reaper-mix-agent    # Build with esbuild (ESM bundle)
pnpm nx test reaper-mix-agent     # Run tests (vitest)
pnpm nx lint reaper-mix-agent     # Lint
pnpm nx typecheck reaper-mix-agent
```

## Architecture

- **`agent.ts`** — Factory function `createAgentContext()` that loads knowledge, resolves plugins, and builds a system prompt
- **`knowledge-loader.ts`** — Parses `knowledge/` markdown files with YAML frontmatter (custom parser, not full YAML)
- **`plugin-resolver.ts`** — Matches installed REAPER FX against plugin knowledge via case-insensitive substring matching on `fx_match` patterns
- **`modes/`** — Workflow mode implementations, each corresponding to a `knowledge/workflows/*.md` file

## Key Patterns

- Knowledge files are categorized by first path segment: `plugins/` → plugin, `genres/` → genre, `workflows/` → workflow, `reference/` → reference
- Files containing `_template` in the path are skipped during loading
- The frontmatter parser is line-by-line — no multi-line arrays or nested YAML objects
- `PluginResolver` uses `fx_match` array from frontmatter for case-insensitive substring matching against REAPER's FX list
- Plugin `preference` score (0-100) determines which plugin wins per category

## Gotchas

- Adding a new workflow mode in `modes/` requires a matching `knowledge/workflows/` file
- Adding a new knowledge type requires updating `typeFromPath()` in `knowledge-loader.ts`
- The frontmatter parser treats `#` as comment lines — don't use `#` in frontmatter values
- `lufs_target` in genre files parses as a string array, not numbers
- The `knowledgeDir` path must be passed at runtime — it resolves relative to the built bundle location

## Coupled Files

Changes here often require changes in `knowledge/` and vice versa:
- `knowledge-loader.ts` ↔ frontmatter schema in knowledge files
- `plugin-resolver.ts` ↔ `fx_match` patterns in `knowledge/plugins/`
- `modes/*.ts` ↔ `knowledge/workflows/*.md`
