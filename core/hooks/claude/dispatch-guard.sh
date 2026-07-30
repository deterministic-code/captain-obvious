#!/usr/bin/env bash
f=$(jq -r ".tool_input.file_path // empty")
case "$f" in
  */backend/src/sql/*/migrations/*)
    jq -nc --arg r "Emitted migrations are codegen output — never hand-edit. Fix scripts/lib/emit-*.mjs and re-run npm run create:all." '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
    ;;
esac
exit 0
