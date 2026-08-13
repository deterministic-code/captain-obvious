#!/usr/bin/env bash
# PreToolUse: run enabled tool-stage guard rules (protected paths, no-edit-on-main)
# on the tool call. Delegates to the Node entry; stdin (the hook event JSON)
# passes straight through to node.
exec node "$(dirname "$0")/pre-tool-guard.mjs"
