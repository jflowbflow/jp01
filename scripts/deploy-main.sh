#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm run build

cp dist/index.html index.html
rm -rf assets
cp -R dist/assets assets
cp dist/.nojekyll .nojekyll 2>/dev/null || touch .nojekyll

echo "Built site copied to repository root."
echo "Commit and push to main, then enable GitHub Pages from the main branch."
