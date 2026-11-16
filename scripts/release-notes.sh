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

# One blank line between packages, whether or not a changelog has an older section after its
# newest one.
first=1
for changelog in "$@"; do
  if [ "$first" -eq 0 ]; then
    echo
  fi
  first=0
  awk '
    NR == 1 && /^# / { name = substr($0, 3); next }
    /^## / { sections++; if (sections == 1) { print "## " name " " substr($0, 4); next } }
    sections == 1 { lines[++count] = $0 }
    END {
      while (count > 0 && lines[count] == "") count--
      for (i = 1; i <= count; i++) print lines[i]
    }
  ' "$changelog"
done
