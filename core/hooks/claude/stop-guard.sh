#!/usr/bin/env bash
# Stop: run the enabled stop-stage guard rule (gov-merge-before-stop) and block
# ending the session while work is unmerged. Delegates to the Node entry.
exec node "$(dirname "$0")/stop-guard.mjs"
