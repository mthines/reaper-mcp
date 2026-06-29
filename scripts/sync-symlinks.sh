#!/usr/bin/env bash
# Wire this repo's Claude-side assets into ~/.claude so the mix skills and
# knowledge are live from your local clone — edits in the repo take effect
# immediately, git tracks every revision, and anything you commit ships to
# whoever clones your fork.
#
# Links created (single hop, repo is the source of truth):
#
#   ~/.claude/skills/<name>     →  <repo>/.claude/skills/<name>      (skill dir w/ SKILL.md)
#   ~/.claude/knowledge         →  <repo>/knowledge                  (whole tree)
#
# Each skill is a directory containing SKILL.md — the layout Claude Code
# discovers. Skills are found recursively (any dir holding a SKILL.md), so a
# flat layout (.claude/skills/<name>/SKILL.md) and a nested category layout
# (.claude/skills/<category>/<name>/SKILL.md) both work; the link is flattened
# to the skill's own basename under ~/.claude/skills.
#
# The mix skills read AND write under ~/.claude/knowledge, so for a symlinked
# clone every learned plugin and process lesson lands in the repo working tree
# (commit it to your fork). The repo's dev rules in .claude/rules are NOT linked
# globally — they describe developing reaper-mcp, not mixing.
#
# Safe to re-run: skips correct links, repairs broken/wrong ones, and refuses to
# overwrite a real file or directory (e.g. a knowledge/ copied by install-skills).
#
# Usage:
#   scripts/sync-symlinks.sh            # apply (verbose per-action log)
#   scripts/sync-symlinks.sh --dry-run  # preview only
#   scripts/sync-symlinks.sh -n         # short form of --dry-run

set -euo pipefail

DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|-n) DRY_RUN=1; shift ;;
    *) echo "error: unknown argument: $1" >&2; echo "usage: $0 [--dry-run|-n]" >&2; exit 1 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"
CLAUDE_SKILLS_DIR="$CLAUDE_DIR/skills"

created=0; repaired=0; skipped_ok=0; skipped_unsafe=0
log() { printf '%s\n' "$*"; }

# Resolve a path to its canonical absolute form (follows .. etc); falls back to
# the raw path if the referent does not exist.
canonicalize() {
  local p="$1"
  ( cd "$(dirname "$p")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename "$p")" ) || printf '%s\n' "$p"
}

ensure_dir() {
  local dir="$1"
  [[ -d "$dir" ]] && return 0
  if (( DRY_RUN )); then log "would create dir  $dir"; else mkdir -p "$dir"; fi
}

# link <link-path> <target-path>
link() {
  local link="$1" target="$2"
  if [[ -L "$link" ]]; then
    if [[ "$(canonicalize "$(readlink "$link")")" == "$(canonicalize "$target")" ]]; then
      skipped_ok=$((skipped_ok + 1)); return 0
    fi
    if (( DRY_RUN )); then log "would repair      $link → $target"; else rm "$link"; ln -s "$target" "$link"; log "repaired          $link → $target"; fi
    repaired=$((repaired + 1)); return 0
  fi
  if [[ -e "$link" ]]; then
    log "SKIP (real file/dir, will not overwrite): $link"
    log "      back it up and remove it, then re-run. (e.g. a knowledge/ copied by install-skills)"
    skipped_unsafe=$((skipped_unsafe + 1)); return 0
  fi
  if (( DRY_RUN )); then log "would create      $link → $target"; else ln -s "$target" "$link"; log "created           $link → $target"; fi
  created=$((created + 1))
}

ensure_dir "$CLAUDE_SKILLS_DIR"

# 1. Each skill dir (any dir holding a SKILL.md) → ~/.claude/skills/<name>
#    Flattened to the skill's own basename, so nested category layouts work too.
while IFS= read -r -d '' skill_md; do
  skill_dir="$(dirname "$skill_md")"
  link "$CLAUDE_SKILLS_DIR/$(basename "$skill_dir")" "$skill_dir"
done < <(find "$REPO_ROOT/.claude/skills" -mindepth 1 -maxdepth 5 -type f -name SKILL.md -print0)

# 2. Whole knowledge tree → ~/.claude/knowledge
link "$CLAUDE_DIR/knowledge" "$REPO_ROOT/knowledge"

log ""
log "summary: $created created, $repaired repaired, $skipped_ok already ok, $skipped_unsafe skipped (unsafe)"
(( DRY_RUN )) && log "(dry run — no changes applied)"
exit 0
