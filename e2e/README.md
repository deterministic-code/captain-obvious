# e2e — hooks fire → log → show in the panel

A Playwright suite that proves the whole audit loop for real. It builds a throwaway
git repo under the OS temp dir, **attaches the real captain-obvious hooks** to it
(`.git/hooks/*` + `.claude/settings.json`, via the same installers
`captain-obvious-install` uses), then **fires every hook type with a real event**:

| Hook | How it's fired |
| --- | --- |
| git **pre-commit** | a real `git commit` (in a Claude context, `CLAUDECODE=1`) |
| git **pre-push** | a real `git push` to a local bare remote |
| Claude **PreToolUse** | a real headless `claude -p` doing one `Write` |
| Claude **Stop** | the same `claude -p` session ending |

Each fired hook runs through the single runner, which logs `run.start` + `run.end`.
The suite serves the panel over the sandbox DBs and asserts, in the browser, that the
**Activity feed shows the start+end pair** for every hook — and that the offline
governance rules (`gov-require-pr`, `gov-main-ci-green`, `gov-tests-green`) never ran.

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
