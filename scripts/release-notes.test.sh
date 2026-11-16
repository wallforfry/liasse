#!/usr/bin/env bash
# Self-test of release-notes.sh on synthetic changelogs. Usage: scripts/release-notes.test.sh
set -euo pipefail

notes="$(cd "$(dirname "$0")" && pwd)/release-notes.sh"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

cat >"$workdir/server.md" <<'EOF'
# @liasse/server

## 0.2.0

### Minor Changes

- abc1234: Something new.

## 0.1.0

### Minor Changes

- def5678: Something old.
EOF

cat >"$workdir/sdk.md" <<'EOF'
# @liasse/sdk

## 0.1.1

### Patch Changes

- 0123456: A fix.
EOF

# A first release: no older section follows the newest one.
cat >"$workdir/web.md" <<'EOF'
# @liasse/web

## 0.1.0

- 89abcde: A first release.
EOF

expected='## @liasse/server 0.2.0

### Minor Changes

- abc1234: Something new.

## @liasse/sdk 0.1.1

### Patch Changes

- 0123456: A fix.

## @liasse/web 0.1.0

- 89abcde: A first release.'

actual="$("$notes" "$workdir/server.md" "$workdir/sdk.md" "$workdir/web.md")"
if [ "$actual" = "$expected" ]; then
  echo "ok   keeps the newest section of each changelog under its package"
else
  echo "FAIL keeps the newest section of each changelog under its package:"
  diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") || true
  exit 1
fi

status=0
"$notes" >/dev/null 2>&1 || status=$?
if [ "$status" -eq 2 ]; then
  echo "ok   refuses to run without a changelog"
else
  echo "FAIL refuses to run without a changelog: expected exit 2, got $status"
  exit 1
fi
