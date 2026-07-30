#!/bin/bash
# PreToolUse guard on Bash: blocks `gh pr merge` while a blocking (unit/integration) check is failing.
# Reads the hook JSON on stdin; exits 2 with a stderr message to block.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0
command -v gh >/dev/null 2>&1 || exit 0

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
case "$cmd" in
  *"gh pr merge"*) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0

# Explicit PR number/URL after `gh pr merge`, else gh resolves the current branch.
selector=$(printf '%s' "$cmd" | sed -nE 's#.*gh pr merge +([0-9]+|https://[^ ]+).*#\1#p')

rollup=$(gh pr view $selector --json number,statusCheckRollup 2>/dev/null) || exit 0
[ -n "$rollup" ] || exit 0
prnum=$(printf '%s' "$rollup" | jq -r '.number')

# Blocking check names come from check-main-ci-green.mjs; empty list (node unavailable) falls back to blocking on ANY failing check.
blocking_jobs=$(node scripts/hooks/check-main-ci-green.mjs --blocking-jobs 2>/dev/null || true)

failing=$(printf '%s' "$rollup" | jq -r --arg blocking "$blocking_jobs" '[.statusCheckRollup[]?
  | (.name? // .context? // "unknown") as $n
  | select(($blocking == "") or (($blocking | split("\n") | index($n)) != null))
  | select(((.conclusion? // .state? // "") | ascii_upcase) as $c
    | ["FAILURE", "TIMED_OUT", "ERROR", "STARTUP_FAILURE"] | index($c) != null)
  | $n] | unique | join(", ")')

if [ -n "$failing" ]; then
  echo "BLOCKED: blocking CI checks are failing on PR #$prnum (failing: $failing). Do not merge and do not bypass with --admin or by disabling checks. Investigate the failures with 'gh pr checks $prnum', fix the root cause, push the fix to this PR, and merge only once the unit and integration checks are green." >&2
  exit 2
fi

pending=$(printf '%s' "$rollup" | jq -r '[.statusCheckRollup[]?
  | select(((.status? // .state? // "") | ascii_upcase) as $s
    | ["IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED"] | index($s) != null)
  | (.name? // .context? // "unknown")] | unique | join(", ")')

# Last real Tests-on-main verdict from check-main-ci-green.mjs; "non-blocking-failure" (only rust/functional jobs red) passes through.
if [ "${ALLOW_MERGE_ON_RED_MAIN:-}" != "1" ]; then
  main_conclusion=$(node scripts/hooks/check-main-ci-green.mjs --verdict 2>/dev/null | cut -f1)
  if [ "$main_conclusion" = "failure" ]; then
    echo "BLOCKED: the latest completed Tests run on main FAILED in a blocking (unit/integration) job. Fixing main takes priority — do not land unrelated work on a red main (pending checks here: ${pending:-none}). Diagnose with 'gh run list --workflow Tests --branch main'. ONLY if this PR is itself the fix for that failure, re-run this exact merge command prefixed with ALLOW_MERGE_ON_RED_MAIN=1 and say so to the user. Never --admin." >&2
    exit 2
  fi
fi

exit 0
