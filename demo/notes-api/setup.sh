#!/usr/bin/env bash
# Materialize the notes-api playground: a committed skeleton with the seeded
# implementation left uncommitted in the working tree, so `gx review` has a
# real diff to review. Idempotent — rebuilds the target dir from scratch.
#
#   ./setup.sh [target-dir]   (default: ./workdir)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="${1:-$here/workdir}"

rm -rf "$target"
mkdir -p "$target"

# 1. Committed baseline: package.json, README, and stub src.
cp -R "$here/base/." "$target/"
git -C "$target" init -q
git -C "$target" add -A
git -C "$target" -c user.email=demo@gx.run -c user.name=demo \
  commit -q -m "notes-api skeleton"

# 2. Seeded implementation, left as an uncommitted working-tree change.
cp -R "$here/overlay/." "$target/"

echo "Playground ready at $target"
echo "Next: cd into it, run 'gx review', and see what it finds."
