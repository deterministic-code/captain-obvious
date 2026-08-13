# e2e — hooks fire → log → show in the panel

A Playwright suite that proves the whole audit loop for real. It builds a throwaway
git repo under the OS temp dir, **attaches the real captain-obvious hooks** to it
(`.git/hooks/*` + `.claude/settings.json`, via the same installers
`captain-obvious-install` uses), then **fires every hook type with a real event**:

| Hook | How it's fired |
| --- | --- |
| Claude **PreToolUse** | a real headless `claude -p` writing two files |
| Claude **PostToolUse** | Prettier `--write` (`tool-fix`) reformats each file as Claude writes it |
| Claude **Stop** | the same `claude -p` session ending |
| git **pre-commit** | a real `git commit` of those files (Claude context, `CLAUDECODE=1`) |
| git **pre-push** | a real `git push` to a local bare remote |

The `claude -p` session writes two files containing the **same messy, duplicated
function**. That drives the whole point of captain-obvious:

- **PostToolUse Prettier** reformats each messy file the moment it's written (`fix/lint-prettier — N file(s) fixed`).
- **pre-push dup ratchet** flags the duplicated function as newly-introduced vs the
  `origin/main` baseline (`pre-push/lint-dup — N issue(s) found`).

Each fired hook runs through the single runner, which logs `run.start` + `run.end`.
The suite serves the panel over the sandbox DBs and asserts, in the browser, that the
**Activity feed shows the start+end pair** for every hook (plus the Prettier fix and
the dup finding) — and that the disabled rules never ran.

`claude -p` runs with `--disallowedTools Bash` so it stays offline (no git/gh) and
can't merge away the unmerged work — which keeps the Stop guard blocking
deterministically.

## Prerequisites

- **Build first:** `npm run build` (the hooks import `core/dist`).
- **Browser:** `npx playwright install chromium` (one-time).
- **Claude Code CLI:** `claude` on PATH and authenticated — the PreToolUse/Stop legs
  drive a real `claude -p` (needs network; incurs normal usage).

## Run

```sh
npm run build
npm run test:e2e
```

This suite is **opt-in** — it is not part of `npm test` and never gates a merge (the
merge gate stays `vitest` + `tsc`).
