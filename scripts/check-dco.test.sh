#!/usr/bin/env bash
# Self-test of check-dco.sh on throwaway repositories. Usage: scripts/check-dco.test.sh
set -euo pipefail

checker="$(cd "$(dirname "$0")" && pwd)/check-dco.sh"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

failures=0

# expect <exit status> <description> <commit message>: one commit by author@example.com on top
# of an empty base commit, then the checker must exit with the given status.
expect() {
  local expected="$1" description="$2" message="$3" repo actual
  repo="$(mktemp -d "$workdir/repo.XXXXXX")"
  git -C "$repo" init -q
  git -C "$repo" config user.name 'Synthetic Author'
  git -C "$repo" config user.email 'author@example.com'
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" commit -q --allow-empty -m 'chore: base'
  git -C "$repo" tag base
  git -C "$repo" commit -q --allow-empty -m "$message"
  actual=0
  (cd "$repo" && "$checker" base HEAD >/dev/null 2>&1) || actual=$?
  if [ "$actual" -eq "$expected" ]; then
    echo "ok   $description"
  else
    echo "FAIL $description: expected exit $expected, got $actual"
    failures=$((failures + 1))
  fi
}

expect 0 'accepts a sign-off by the author' \
  $'feat: change\n\nSigned-off-by: Synthetic Author <author@example.com>'

expect 0 'compares the email without regard to case' \
  $'feat: change\n\nSigned-off-by: Synthetic Author <Author@Example.com>'

expect 0 'accepts the author among several sign-offs' \
  $'feat: change\n\nSigned-off-by: Someone Else <else@example.com>\nSigned-off-by: Synthetic Author <author@example.com>'

expect 1 'rejects a commit without sign-off' \
  'feat: change'

expect 1 'rejects a sign-off by someone else only' \
  $'feat: change\n\nSigned-off-by: Someone Else <else@example.com>'

expect 1 'does not take Co-Authored-By for a sign-off' \
  $'feat: change\n\nCo-Authored-By: Synthetic Author <author@example.com>'

expect 1 'rejects a sign-off outside the trailer block' \
  $'feat: change\n\nSigned-off-by: Synthetic Author <author@example.com>\n\nA closing paragraph.'

unknown_base=0
(cd "$workdir" && git init -q probe && cd probe && "$checker" 0000000000000000000000000000000000000000 HEAD >/dev/null 2>&1) || unknown_base=$?
if [ "$unknown_base" -ne 0 ] && [ "$unknown_base" -ne 1 ]; then
  echo 'ok   fails when git cannot list the commits'
else
  echo "FAIL fails when git cannot list the commits: got exit $unknown_base"
  failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
