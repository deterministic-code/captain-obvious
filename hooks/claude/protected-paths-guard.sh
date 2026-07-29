#!/usr/bin/env bash
# PreToolUse guard: deny edits to a path the project marks protected. Delegates
# to the Node entry (registry DB lives behind the compiled layer). stdin (the
# hook event JSON) passes straight through to node.
exec node "$(dirname "$0")/protected-paths-guard.mjs"
