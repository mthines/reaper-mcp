# Sync Agent Documentation

Audit all production workflow agents and their linked knowledge files to ensure naming, cross-references, and documentation are consistent.

## What to check

### 1. Agent inventory

Read all files in `.claude/agents/*.md`. Build a table of:

| Agent file | `name` (frontmatter) | `@name` references found in other agents |

Verify that every `name` frontmatter value matches the filename (without `.md`).

### 2. Cross-reference consistency

Search all agent files for `@agent-name` references. For each reference found:

- Confirm a matching agent file exists (`.claude/agents/{name}.md`)
- If not, flag it as a broken reference

### 3. Producer pipeline order

Read `.claude/agents/producer.md` and extract the numbered pipeline. Verify:

- Every agent listed in the pipeline has a corresponding file in `.claude/agents/`
- Every agent file in `.claude/agents/` (except `producer.md` itself) appears in the pipeline
- The pipeline numbering is sequential with no gaps

### 4. Knowledge workflow links

Each agent that references a `knowledge/workflows/*.md` file — verify the file exists.

Each `knowledge/workflows/*.md` file — verify its `id` frontmatter matches its filename (without `.md`).

### 5. Frontmatter consistency

For all agent files, verify:

- `name` matches the filename
- `tools` is present
- `mcpServers` includes `reaper`
- `model` is set
- `permissionMode` is set

For all knowledge workflow files, verify:

- `name` is present
- `id` matches the filename
- `description` is present

## Output

Generate a report:

```
## Agent Documentation Sync Report

### Agents Found
| # | File | Name | Tools | Cross-references |
|---|------|------|-------|-----------------|

### Pipeline (from producer.md)
| # | Phase | Agent | File exists |
|---|-------|-------|------------|

### Knowledge Workflows
| File | id | Referenced by agent |
|------|-----|-------------------|

### Issues Found
- [list any problems]

### Status: ALL CLEAR / ISSUES FOUND
```

## Fix mode

If the user passes `--fix` as an argument, automatically fix any issues found:

- Rename frontmatter `name` fields to match filenames
- Update broken `@agent-name` references to the correct agent name
- Add missing agents to the producer pipeline
- Flag issues that require manual intervention
