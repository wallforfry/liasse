#!/usr/bin/env bash
# Release notes: the newest section of every given CHANGELOG.md, each under the name and version
# of its package. Changesets writes each file as `# <package>`, then one `## <version>` section
# per release, newest first.
# Usage: scripts/release-notes.sh <CHANGELOG.md>...
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <CHANGELOG.md>..." >&2
  exit 2
fi

for changelog in "$@"; do
  awk '
    NR == 1 && /^# / { name = substr($0, 3); next }
    /^## / { sections++; if (sections == 1) { print "## " name " " substr($0, 4); next } }
    sections == 1 { print }
  ' "$changelog"
done
