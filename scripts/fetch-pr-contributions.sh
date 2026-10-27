#!/usr/bin/env bash
# Download a PR's contribution files (knowledge/contributions/**/*.md) at a given commit into a
# directory, as data. Used by .github/workflows/plugin-contributions.yml, which runs on
# pull_request_target and so never checks out the PR's code.
#
#   scripts/fetch-pr-contributions.sh <owner/repo> <pr-number> <head-sha> <out-dir>
#
# Prints the downloaded paths. Exits 2 when the PR also changes files outside
# knowledge/contributions/, so a contribution PR can't carry anything else.
set -euo pipefail

repo="$1" pr="$2" sha="$3" out="$4"
mkdir -p "$out"

others=0
while IFS=$'\t' read -r status path; do
  case "$path" in
    knowledge/contributions/README.md) continue ;;
    knowledge/contributions/*) ;;
    *) others=1; echo "outside knowledge/contributions/: $path" >&2; continue ;;
  esac
  [ "$status" = "removed" ] && continue
  if [[ ! "$path" =~ ^knowledge/contributions/[A-Za-z0-9._/-]+\.md$ ]] || [[ "$path" == *..* ]]; then
    echo "skipping unexpected file name: $path" >&2
    others=1
    continue
  fi
  dest="$out/${path#knowledge/contributions/}"
  mkdir -p "$(dirname "$dest")"
  gh api -H 'Accept: application/vnd.github.raw' "repos/$repo/contents/$path?ref=$sha" > "$dest"
  echo "$dest"
done < <(gh api --paginate "repos/$repo/pulls/$pr/files" --jq '.[] | [.status, .filename] | @tsv')

exit $((others * 2))
