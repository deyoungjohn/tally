#!/usr/bin/env bash
# Build a review pack for a work-order branch (run in WSL, from any clone or worktree of the repo).
#
#   bash scripts/review-pack.sh mod/WO-00-foundation            # diff + owned-path check + typecheck/lint/format/test
#   FULL=1 bash scripts/review-pack.sh mod/WO-00-foundation     # also pnpm build + e2e (needs Playwright browsers)
#
# The pack is written where the orchestrator can read it: the Windows clone's review/ folder
# (default /mnt/c/Users/DELL/Projects/tally/review). Override with REVIEW_OUT=/some/dir.
# The branch does not need to be pushed: local branches from any worktree are visible to every worktree.
set -uo pipefail

branch="${1:?usage: bash scripts/review-pack.sh <branch> [base]}"
base="${2:-origin/main}"
repo="$(git rev-parse --show-toplevel)" || { echo "run inside the repo"; exit 1; }
cd "$repo"
default_out="/mnt/c/Users/DELL/Projects/tally/review"
[ -d "$(dirname "$default_out")" ] || default_out="$repo/review"
out_root="${REVIEW_OUT:-$default_out}"
name="${branch//\//_}"
out="$out_root/$name"
wt="$(dirname "$repo")/.review-wt-$name"
mkdir -p "$out"

git fetch origin --quiet || echo "warning: git fetch failed, using local refs"
if git rev-parse --verify --quiet "refs/heads/$branch" >/dev/null; then
  ref="$branch"                       # local branch (agent worktree) wins: it has the newest commits
elif git rev-parse --verify --quiet "refs/remotes/origin/$branch" >/dev/null; then
  ref="origin/$branch"
else
  echo "branch $branch not found locally or on origin"; exit 1
fi

{
  echo "branch: $branch ($ref) at $(git rev-parse --short "$ref")"
  echo "base:   $base at $(git rev-parse --short "$base")"
  echo "merge-base: $(git merge-base "$base" "$ref" | cut -c1-7)"
  echo "behind base by: $(git rev-list --count "$ref..$base") commits"
  echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$out/meta.txt"
git log --format='%h %ad %s' --date=short "$base..$ref" > "$out/commits.txt"
git diff --stat "$base...$ref" > "$out/stat.txt"
git diff --name-only "$base...$ref" > "$out/files.txt"
git diff "$base...$ref" > "$out/diff.patch"

# uncommitted work in the agent's worktree is invisible to the diff: list it so nothing is missed
agent_wt="$(git worktree list --porcelain | awk -v b="refs/heads/$branch" '/^worktree /{w=$2} $0=="branch "b{print w}')"
if [ -n "$agent_wt" ]; then
  echo "agent worktree: $agent_wt" > "$out/uncommitted.txt"
  git -C "$agent_wt" status --porcelain >> "$out/uncommitted.txt"
fi

# owned-path check uses the work order and checker as they are on the branch
tmp_wo="$(mktemp -d)"; mkdir -p "$tmp_wo/docs/work-orders" "$tmp_wo/scripts"
git show "$ref:scripts/review_owned.py" > "$tmp_wo/scripts/review_owned.py" 2>/dev/null || cp scripts/review_owned.py "$tmp_wo/scripts/"
for f in $(git ls-tree --name-only "$ref" docs/work-orders/); do git show "$ref:$f" > "$tmp_wo/$f"; done
( cd "$tmp_wo" && python3 scripts/review_owned.py "$branch" "$out/files.txt" ) > "$out/owned.txt" 2>&1
echo "owned-path check exit: $?" >> "$out/owned.txt"
rm -rf "$tmp_wo"

# run the checks in a clean, detached worktree of the branch
git worktree remove --force "$wt" 2>/dev/null; rm -rf "$wt"
git worktree add --quiet --detach "$wt" "$ref" || { echo "worktree add failed"; exit 1; }
steps=("pnpm install --frozen-lockfile" "pnpm typecheck" "pnpm lint" "pnpm format:check" "pnpm test")
if [ "${FULL:-0}" = "1" ]; then
  steps+=("pnpm build" "pnpm e2e")
  git show "$ref:package.json" 2>/dev/null | grep -q '"e2e:foundation"' && steps+=("pnpm e2e:foundation")
fi
(
  cd "$wt" || exit 1
  for step in "${steps[@]}"; do
    echo "===== $step"
    start=$(date +%s)
    bash -c "$step" > step.log 2>&1; code=$?
    tail -n 150 step.log
    echo "===== exit: $code ($(( $(date +%s) - start ))s)"
  done
  rm -f step.log
) > "$out/checks.txt" 2>&1
git worktree remove --force "$wt" 2>/dev/null; rm -rf "$wt"

echo "Review pack: $out"
grep -E "^===== " "$out/checks.txt" | paste - -
tail -n 1 "$out/owned.txt"
