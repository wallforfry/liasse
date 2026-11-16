#!/usr/bin/env bash
# Releases the version of @liasse/server that <commit> carries, unless it is tagged already: a
# GitHub release v<version> on the commit that cut that version, with the changelogs changed
# since the previous v* tag as notes. Prints `tag=v<version>` when it released one.
# Every file is read from commits, never from the working tree, which a version script may have
# changed since.
# Usage: scripts/release-tag.sh [<commit>] (default HEAD); needs `gh` authenticated.
set -euo pipefail

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [<commit>]" >&2
  exit 2
fi

head="$(git rev-parse --verify "${1:-HEAD}^{commit}")"
notes_script="$(cd "$(dirname "$0")" && pwd)/release-notes.sh"
manifest=apps/server/package.json

version="$(git show "$head:$manifest" | node -e '
  let text = "";
  process.stdin.on("data", (chunk) => (text += chunk));
  process.stdin.on("end", () => console.log(JSON.parse(text).version));
')"
tag="v$version"
if [ "$version" = 0.0.0 ] || git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "Nothing to release: $tag is already tagged or no version was ever cut." >&2
  exit 0
fi

# The release is the commit that cut the version, never a later one.
released="$(git log -1 --format=%H -G '"version":' "$head" -- "$manifest")"
previous="$(git describe --tags --abbrev=0 --match 'v*' "$released" 2>/dev/null ||
  git hash-object -t tree /dev/null)"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
files=()
while IFS= read -r changelog; do
  file="$workdir/${changelog//\//_}"
  git show "$released:$changelog" >"$file"
  files+=("$file")
done < <(git diff --name-only "$previous" "$released" -- '*CHANGELOG.md')
if [ "${#files[@]}" -eq 0 ]; then
  echo "No changelog changed up to $released, yet $tag is not tagged." >&2
  exit 1
fi

"$notes_script" "${files[@]}" >"$workdir/notes.md"
gh release create "$tag" --target "$released" --title "$tag" --notes-file "$workdir/notes.md" >&2
echo "tag=$tag"
