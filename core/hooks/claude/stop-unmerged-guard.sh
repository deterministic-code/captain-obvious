#!/bin/bash
# Stop hook: blocks Claude from stopping while work is unmerged.
# Reads JSON on stdin (ignored). Outputs JSON {"decision":"block","reason":...}
# on stdout when blocking; exits 0 silently when allowed.

set -uo pipefail

# Find a project dir to operate in.
cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0

command -v git >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

branch=$(git symbolic-ref --short HEAD 2>/dev/null) || exit 0
[ "$branch" = "main" ] && exit 0

block() {
  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg r "$1" '{decision:"block",reason:$r}'
  else
    # JSON-escape the message with python3 (always available on macOS/CI).
    python3 -c 'import json,sys; print(json.dumps({"decision":"block","reason":sys.argv[1]}))' "$1"
  fi
  exit 0
}

# 1. Uncommitted changes.
if [ -n "$(git status --porcelain)" ]; then
  block "Stop blocked: uncommitted changes on branch '$branch'. Commit them first (git add + git commit), then push, open a PR, and merge before stopping."
fi

# 2. Unpushed commits (only if a tracking branch exists).
if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  ahead=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
  if [ "${ahead:-0}" != "0" ]; then
    block "Stop blocked: branch '$branch' has $ahead local commit(s) ahead of remote. Push them (git push), then PR + merge."
  fi
fi

# 3 + 4. PR state.
if command -v gh >/dev/null 2>&1; then
  pr_info=$(gh pr list --head "$branch" --state open --json number,isDraft --limit 1 2>/dev/null || echo '[]')
  if [ "$pr_info" != "[]" ] && [ -n "$pr_info" ]; then
    # If a non-draft open PR exists, demand a merge.
    pr_num=$(printf '%s' "$pr_info" | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  if d and not d[0].get("isDraft"): print(d[0]["number"])
except Exception: pass
' 2>/dev/null)
    if [ -n "$pr_num" ]; then
      block "Stop blocked: open non-draft PR #$pr_num for branch '$branch'. Arm auto-merge: gh pr merge $pr_num --squash --auto --delete-branch (it lands when required checks pass — NEVER use --admin)."
    fi
  else
    # No open PR — does this branch have commits not on main?
    if git rev-parse --verify main >/dev/null 2>&1; then
      extra=$(git rev-list --count "main..$branch" 2>/dev/null || echo 0)
      if [ "${extra:-0}" != "0" ]; then
        block "Stop blocked: branch '$branch' has $extra commit(s) not on main and no open PR. Open one (gh pr create), then merge."
      fi
    fi
  fi
fi

exit 0
