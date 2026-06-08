#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREE="$ROOT/.gh-pages-worktree"

cd "$ROOT"
npm run build

if [ -d "$WORKTREE" ]; then
  git worktree remove --force "$WORKTREE" 2>/dev/null || rm -rf "$WORKTREE"
fi

git fetch origin gh-pages 2>/dev/null || true
git worktree add -B gh-pages "$WORKTREE" origin/gh-pages 2>/dev/null \
  || git worktree add -B gh-pages "$WORKTREE"

find "$WORKTREE" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
cp -R "$ROOT/dist/." "$WORKTREE/"
touch "$WORKTREE/.nojekyll"

cd "$WORKTREE"
git add -A
if git diff --cached --quiet; then
  echo "No changes to deploy."
else
  git commit -m "Deploy line tracker to GitHub Pages"
  git push origin gh-pages
fi

echo "Deployed to https://jflowbflow.github.io/jp01/"
