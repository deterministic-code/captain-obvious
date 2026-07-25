#!/bin/bash
# SessionStart hook: surface the last real Tests-on-main verdict so a red main is visible before any work starts.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0
command -v gh >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0

line=$(node scripts/hooks/check-main-ci-green.mjs --verdict 2>/dev/null) || exit 0
[ -n "$line" ] || exit 0

conclusion=${line%%$'\t'*}
if [ "$conclusion" = "failure" ]; then
  echo "MAIN CI IS RED — latest completed Tests run on main failed: ${line}. Fixing main takes priority over new work; the pre-merge guard blocks landing anything unrelated."
elif [ "$conclusion" = "non-blocking-failure" ]; then
  echo "main CI (Tests): latest run failed only outside the blocking unit/integration jobs (rust/functional) — merges are NOT blocked, but the failure is worth investigating: ${line}"
else
  echo "main CI (Tests): ${line}"
fi
exit 0
