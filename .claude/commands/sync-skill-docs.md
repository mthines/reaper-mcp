---
name: sync-skill-docs
description: Audit the mix skills and their linked knowledge files to ensure naming, cross-references, and documentation are consistent
---

# Sync Skill Documentation

Audit the mix skills (`.claude/skills/*.md`) and their linked knowledge files to
ensure naming, cross-references, and documentation are consistent.

## What to check

### 1. Skill inventory

Read all files in `.claude/skills/*.md`. Build a table of `name` (frontmatter) and
the `/skill` references found in other skills. Verify every `name` matches its
filename (without `.md`). The expected mix set is: `mixer`, `critique`,
`mastering`, `learn-plugin`, `mix-memory`.

### 2. Cross-reference consistency

Search all skill files for `/skill-name` references (e.g. `/mixer`, `/critique`,
`/mastering`, `/mix-memory`). For each, confirm a matching skill file exists; flag
broken references. Confirm no skill references a removed agent (`@mixer`,
`@critique`, `@mastering`, `@levels`, `@producer`, …) — they're skills now, invoked
with `/`.

### 3. Knowledge links

Each skill that references a `knowledge/**/*.md` file (workflows, reference,
plugins, genres) — verify the file exists. In particular confirm
`knowledge/reference/memory-protocol.md` exists (the memory contract the skills
depend on).

Each `knowledge/workflows/*.md` file — verify its `id` frontmatter matches its
filename (without `.md`).

### 4. Frontmatter consistency

For all skill files, verify:

- `name` matches the filename
- `description` is present, third-person, and lists trigger phrases incl. the
  slash form
- `argument-hint` is present (or `''` for no-arg skills)
- `metadata.tags` has 5–10 specific tags

## Output

Generate a report:

```
## Skill Documentation Sync Report

### Skills Found
| File | Name | Cross-references | argument-hint |
|------|------|------------------|---------------|

### Knowledge Links
| File | Referenced by skill | Exists |
|------|---------------------|--------|

### Issues Found
- [list any problems]

### Status: ALL CLEAR / ISSUES FOUND
```

## Fix mode

If the user passes `--fix`, automatically fix issues found:

- Rename frontmatter `name` fields to match filenames
- Update broken `/skill-name` references to the correct skill name
- Convert any leftover `@skill` (agent-style) references to `/skill`
- Flag issues that require manual intervention
