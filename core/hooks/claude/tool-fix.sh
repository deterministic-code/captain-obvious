#!/usr/bin/env bash
# PostToolUse: run enabled tool-stage fixes (e.g. prettier --write) on the file
# Claude just wrote. Delegates to the Node entry; stdin (the hook event JSON)
# passes straight through to node.
exec node "$(dirname "$0")/tool-fix.mjs"
