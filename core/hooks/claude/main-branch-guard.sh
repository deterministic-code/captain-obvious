#!/usr/bin/env bash
# PreToolUse guard: deny edits / dangerous git commands while HEAD is main or master.
# Enforces CLAUDE.md "Never work off main directly". Bypass: ALLOW_EDIT_ON_MAIN=1.
set -u
input=$(cat)

if [ "${ALLOW_EDIT_ON_MAIN:-}" = "1" ]; then exit 0; fi

tool=$(printf '%s' "$input" | jq -r '.tool_name // empty')
dir=""

case "$tool" in
  Edit|Write|NotebookEdit)
    fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
    [ -z "$fp" ] && exit 0
    dir=$(dirname "$fp")
    ;;
  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
    [ -z "$cmd" ] && exit 0
    case "$cmd" in *"ALLOW_EDIT_ON_MAIN=1"*) exit 0 ;; esac
    shell_cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
    dir=$(SHELL_CWD="$shell_cwd" CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}" python3 - "$cmd" <<'PY'
import os, re, sys
cmd = sys.argv[1]
cwd = os.environ.get("SHELL_CWD") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
FORBIDDEN = re.compile(r"^git\s+(commit|add|stash|rebase|reset|checkout\s+--)")
GIT_C = re.compile(r"^git\s+-C\s+(\S+)\s+(.*)")
CD = re.compile(r"^cd\s+(\S+)")
for stmt in re.split(r"\s*(?:&&|\|\||;|\n)\s*", cmd):
    stmt = stmt.strip()
    if not stmt:
        continue
    m = CD.match(stmt)
    if m:
        t = m.group(1).strip("\"'")
        cwd = t if t.startswith("/") else os.path.normpath(os.path.join(cwd, t))
        continue
    m = GIT_C.match(stmt)
    if m:
        t = m.group(1).strip("\"'")
        cwd = t if t.startswith("/") else os.path.normpath(os.path.join(cwd, t))
        stmt = "git " + m.group(2)
    if FORBIDDEN.match(stmt):
        print(cwd)
        sys.exit(0)
sys.exit(1)
PY
)
    [ -z "$dir" ] && exit 0
    ;;
  *) exit 0 ;;
esac

[ -d "$dir" ] || exit 0
toplevel=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
branch=$(git -C "$toplevel" symbolic-ref --short HEAD 2>/dev/null) || exit 0

case "$branch" in
  main|master)
    reason="BLOCKED on branch '$branch' in $toplevel. CLAUDE.md: 'Never work off main directly'. Create a worktree first:  git worktree add -b <slug> .worktrees/<slug> $branch  — then edit there. Bypass for one call: ALLOW_EDIT_ON_MAIN=1."
    jq -nc --arg r "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
    exit 0
    ;;
esac
exit 0
