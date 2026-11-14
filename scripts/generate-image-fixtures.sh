#!/bin/sh
# Regenerates the committed image fixtures of packages/core/src/text/fixtures.
# Node has no HEIC or JPEG encoder, so this runs on macOS only, where `sips` provides both.
# The source is a synthetic gradient: no fixture comes from a real photograph.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fixtures="$root/packages/core/src/text/fixtures"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$fixtures"
node --experimental-strip-types --input-type=module -e "
  import { writeFileSync } from 'node:fs';
  import { buildSyntheticPng } from '$root/packages/core/src/testing/synthetic-png.ts';
  writeFileSync('$work/gradient.png', buildSyntheticPng(64, 48));
"
sips -s format heic "$work/gradient.png" --out "$fixtures/gradient-64x48.heic" >/dev/null
sips -s format jpeg "$work/gradient.png" --out "$fixtures/gradient-64x48.jpg" >/dev/null
