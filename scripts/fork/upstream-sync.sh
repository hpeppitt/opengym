#!/usr/bin/env bash
# Merge an upstream ref into the current branch and run the fork's gate on the result (OG-004).
# Used by .github/workflows/fork-upstream-sync.yml, and runnable by hand in a scratch worktree.
#
#   bash scripts/fork/upstream-sync.sh [upstream-ref] [report-file]
#
# Defaults: upstream/main, ./upstream-sync-report.md. Never touches main: run it on a throwaway
# branch. Always exits 0 once it has a verdict, so the caller can report; the verdict is printed
# as `status=<current|conflict|fail|pass>` and appended to $GITHUB_OUTPUT when that is set.
# A conflicted merge is aborted, so the tree is left as it was. SKIP_INSTALL=1 skips npm ci.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

REF="${1:-upstream/main}"
REPORT="${2:-upstream-sync-report.md}"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

verdict() {
  echo "status=$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "status=$1" >> "$GITHUB_OUTPUT"; fi
}

if ! git rev-parse --verify --quiet "$REF^{commit}" >/dev/null; then
  echo "upstream-sync: unknown ref $REF (fetch upstream first)" >&2; exit 2
fi

behind=$(git rev-list --count "HEAD..$REF")
sha=$(git rev-parse --short "$REF")
tag=$(git describe --tags --abbrev=0 "$REF" 2>/dev/null || echo "none")

if [ "$behind" = 0 ]; then
  printf '## Upstream sync: up to date\n\nThe fork already contains `%s` (%s).\n' "$sha" "$REF" > "$REPORT"
  verdict current; exit 0
fi

{
  echo "Upstream \`$REF\` is at \`$sha\` (latest tag \`$tag\`), $behind commits ahead of the fork."
  echo
  echo "<details><summary>Upstream commits not in the fork</summary>"
  echo
  echo '```'
  git log --oneline --no-merges "HEAD..$REF" | head -50
  echo '```'
  echo "</details>"
  echo
} > "$REPORT.body"

if ! git merge --no-ff --no-edit "$REF" >"$LOG" 2>&1; then
  files=$(git diff --name-only --diff-filter=U)
  git merge --abort
  {
    echo "## Upstream sync: merge conflict"
    echo
    cat "$REPORT.body"
    echo "These files conflict. Resolve by hand on a branch:"
    echo
    echo "$files" | sed 's/^/- `/; s/$/`/'
    echo
    echo '```bash'
    echo "git fetch upstream && git checkout -b fork/upstream-merge main && git merge upstream/main"
    echo '```'
  } > "$REPORT"
  rm -f "$REPORT.body"
  verdict conflict; exit 0
fi

gate_ok=1
if [ "${SKIP_INSTALL:-0}" != 1 ]; then
  for d in frontend mcp api; do
    echo "== npm ci $d" >>"$LOG"
    (cd "$d" && npm ci --no-audit --no-fund) >>"$LOG" 2>&1 || gate_ok=0
  done
fi
if [ "$gate_ok" = 1 ]; then bash scripts/fork/check.sh >>"$LOG" 2>&1 || gate_ok=0; fi
# check.sh runs the tests; a broken import or bad JSX only shows in a real build (upstream CI does both).
if [ "$gate_ok" = 1 ]; then
  echo "== frontend build" >>"$LOG"
  (cd frontend && npm run build) >>"$LOG" 2>&1 || gate_ok=0
fi

if [ "$gate_ok" = 1 ]; then
  {
    echo "## Upstream sync: clean merge, gate passes"
    echo
    cat "$REPORT.body"
    echo "The merge is clean and \`scripts/fork/check.sh\` plus the frontend build pass on it."
    echo "Merge it with a merge commit, never squash or rebase (docs/fork/FORK.md)."
  } > "$REPORT"
  status=pass
else
  {
    echo "## Upstream sync: clean merge, gate fails"
    echo
    cat "$REPORT.body"
    echo "The merge is clean but the gate fails on it. Last lines of the output:"
    echo
    echo '```'
    tail -40 "$LOG"
    echo '```'
  } > "$REPORT"
  status=fail
fi
rm -f "$REPORT.body"
verdict "$status"
