#!/usr/bin/env bash
# Build a review pack for a work-order branch: diff, file list, owned-path check, and check output.
# Usage: bash scripts/review-pack.sh mod/WO-04-flow [base=origin/main]
set -uo pipefail
branch="${1:?branch name, e.g. mod/WO-04-flow}"
base="${2:-origin/main}"
name="${branch//\//_}"
out="review/$name"
wt=".review-wt/$name"
mkdir -p "$out"
git fetch origin --quiet
git rev-parse --verify --quiet "origin/$branch" >/dev/null && ref="origin/$branch" || ref="$branch"

git log --oneline "$base..$ref" > "$out/commits.txt"
git diff --stat "$base...$ref" > "$out/stat.txt"
git diff --name-only "$base...$ref" > "$out/files.txt"
git diff "$base...$ref" > "$out/diff.patch"
python3 scripts/review_owned.py "$branch" "$out/files.txt" > "$out/owned.txt" 2>&1
echo "owned-path check exit: $?" >> "$out/owned.txt"

rm -rf "$wt"; git worktree add --quiet --detach "$wt" "$ref"
(
  cd "$wt" || exit 1
  for step in "pnpm install --frozen-lockfile" "pnpm typecheck" "pnpm lint" "pnpm format:check" "pnpm test"; do
    echo "===== $step"; $step 2>&1 | tail -n 200; echo "===== exit: ${PIPESTATUS[0]}"
  done
) > "$out/checks.txt" 2>&1
git worktree remove --force "$wt"
echo "Review pack written to $out/ (commits, stat, files, diff.patch, owned, checks)"
grep -E "^===== (exit|pnpm)" "$out/checks.txt" | paste - - ; tail -n 1 "$out/owned.txt"
