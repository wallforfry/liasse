#!/usr/bin/env bash
# Self-test of release-tag.sh on throwaway repositories, with `gh` replaced by a stub that
# records its arguments and notes. Usage: scripts/release-tag.test.sh
set -euo pipefail

scripts="$(cd "$(dirname "$0")" && pwd)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

mkdir "$workdir/bin"
cat >"$workdir/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >"$GH_LOG"
while [ "$#" -gt 0 ]; do
  if [ "$1" = --notes-file ]; then cp "$2" "$GH_LOG.notes"; fi
  shift
done
EOF
chmod +x "$workdir/bin/gh"
export PATH="$workdir/bin:$PATH"

failures=0
report() {
  if [ "$1" = ok ]; then
    echo "ok   $2"
  else
    echo "FAIL $2: $3"
    failures=$((failures + 1))
  fi
}

# new_repo: a repository whose server is at 0.0.0, with the release scripts in place.
new_repo() {
  local repo
  repo="$(mktemp -d "$workdir/repo.XXXXXX")"
  git -C "$repo" init -q
  git -C "$repo" config user.name 'Synthetic Author'
  git -C "$repo" config user.email 'author@example.com'
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" config tag.gpgsign false
  mkdir -p "$repo/apps/server" "$repo/scripts"
  cp "$scripts/release-tag.sh" "$scripts/release-notes.sh" "$repo/scripts/"
  set_version "$repo" 0.0.0
  git -C "$repo" add -A
  git -C "$repo" commit -q -m 'chore: base'
  echo "$repo"
}

set_version() {
  printf '{\n  "name": "@liasse/server",\n  "version": "%s"\n}\n' "$2" >"$1/apps/server/package.json"
}

# cut_version <repo> <version>: the commit of a merged version pull request.
cut_version() {
  set_version "$1" "$2"
  printf '# @liasse/server\n\n## %s\n\n- Change of %s.\n' "$2" "$2" >"$1/apps/server/CHANGELOG.md"
  git -C "$1" add -A
  git -C "$1" commit -q -m "chore(release): version packages"
}

# later_commit <repo>: a commit after the version, which leaves the version as it is.
later_commit() {
  git -C "$1" checkout -q -- apps/server/package.json
  echo "$RANDOM" >>"$1/later.md"
  git -C "$1" add -A
  git -C "$1" commit -q -m 'feat: something later'
}

# run <repo>: release-tag.sh with a working tree dirtied by a version script bumping to 9.9.9,
# as changesets/action leaves it. Sets `status` and `output`; the gh call lands in $GH_LOG.
run() {
  export GH_LOG="$1/.gh.log"
  rm -f "$GH_LOG" "$GH_LOG.notes"
  set_version "$1" 9.9.9
  status=0
  output="$(cd "$1" && scripts/release-tag.sh 2>/dev/null)" || status=$?
}

repo="$(new_repo)"
run "$repo"
if [ "$status" -eq 0 ] && [ -z "$output" ] && [ ! -e "$GH_LOG" ]; then
  report ok 'releases nothing before a version was cut, whatever the working tree says'
else
  report fail 'releases nothing before a version was cut' "exit $status, output '$output'"
fi

repo="$(new_repo)"
cut_version "$repo" 0.1.0
cut="$(git -C "$repo" rev-parse HEAD)"
run "$repo"
if [ "$status" -eq 0 ] && [ "$output" = tag=v0.1.0 ] &&
  [ "$(cat "$GH_LOG")" = "release create v0.1.0 --target $cut --title v0.1.0 --notes-file $(sed 's/.*--notes-file //' "$GH_LOG")" ] &&
  grep -qx '## @liasse/server 0.1.0' "$GH_LOG.notes"; then
  report ok 'releases the version a merged version pull request cut'
else
  report fail 'releases the version a merged version pull request cut' "exit $status, output '$output', gh '$(cat "$GH_LOG" 2>/dev/null)'"
fi

later_commit "$repo"
run "$repo"
if [ "$status" -eq 0 ] && [ "$output" = tag=v0.1.0 ] && grep -q -- "--target $cut " "$GH_LOG" &&
  grep -qx '## @liasse/server 0.1.0' "$GH_LOG.notes"; then
  report ok 'releases the commit that cut the version when a later run comes first'
else
  report fail 'releases the commit that cut the version when a later run comes first' "exit $status, output '$output', gh '$(cat "$GH_LOG" 2>/dev/null)'"
fi

git -C "$repo" tag v0.1.0 "$cut"
later_commit "$repo"
run "$repo"
if [ "$status" -eq 0 ] && [ -z "$output" ] && [ ! -e "$GH_LOG" ]; then
  report ok 'releases nothing once the version is tagged'
else
  report fail 'releases nothing once the version is tagged' "exit $status, output '$output'"
fi

cut_version "$repo" 0.2.0
run "$repo"
if [ "$status" -eq 0 ] && [ "$output" = tag=v0.2.0 ] &&
  [ "$(grep -c '^## ' "$GH_LOG.notes")" -eq 1 ]; then
  report ok 'takes the notes of the changelogs changed since the previous tag'
else
  report fail 'takes the notes of the changelogs changed since the previous tag' "exit $status, output '$output'"
fi

repo="$(new_repo)"
set_version "$repo" 0.1.0
git -C "$repo" add -A
git -C "$repo" commit -q -m 'chore: a version without a changelog'
run "$repo"
if [ "$status" -eq 1 ] && [ ! -e "$GH_LOG" ]; then
  report ok 'refuses a version that no changelog describes'
else
  report fail 'refuses a version that no changelog describes' "exit $status"
fi

if [ "$failures" -gt 0 ]; then
  exit 1
fi
