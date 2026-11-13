#!/usr/bin/env bash
# Developer Certificate of Origin check: every non-merge commit of <base>..<head> must
# carry a Signed-off-by trailer with the email of its author.
# Usage: scripts/check-dco.sh <base> [<head>]
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: $0 <base> [<head>]" >&2
  exit 2
fi

base="$1"
head="${2:-HEAD}"

commits="$(git rev-list --no-merges "$base..$head")"

checked=0
unsigned=""
for commit in $commits; do
  email="$(git show -s --format='%ae' "$commit")"
  signoffs="$(git show -s --format='%(trailers:key=Signed-off-by,valueonly)' "$commit")"
  if ! grep -qiF -- "<$email>" <<<"$signoffs"; then
    unsigned="$unsigned  $commit <$email>"$'\n'
  fi
  checked=$((checked + 1))
done

if [ -n "$unsigned" ]; then
  echo "These commits have no Signed-off-by trailer from their author (use git commit -s):"
  printf '%s' "$unsigned"
  exit 1
fi

echo "DCO: $checked commit(s) signed off by their author."
