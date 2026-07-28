## Project

`@deterministic-code/captain-obvious` — deterministic, mechanical lint gates + Claude Code
guard hooks, installable into any repo. The package ships the **hook implementations**; each
consuming repo owns a `captain-obvious.config.json` that decides **which** hooks run, in what
order, and which are advisory — so one package drives a strict repo and a lax one without forking.

- **`src/`** — strict TypeScript, compiled to `dist/` by `tsc`. The registry lives here:
  - `src/db/` — the SQLite catalog via `better-sqlite3` (`open`, `rules`, `fixes`, `actions`,
    `languages`, `seed`, `lookups`, `types`, `args`).
  - `src/rules/` — the bundled rule set (`define`, `index`, `languages`, `types`) seeded into the DB.
  - `src/server/` — the web control panel: `serve.ts` (routing + static SPA), `registry.ts`
    (shapes `/api/*` from `data/captain-obvious.db`), `profiling.ts` (reads read-only `.profile/profile.db`).
  - `src/bin/captain-obvious.ts` — the CLI entry (`add-rule`, `configure-rule`, `configure-action`,
    `seed-rules`, `show-rule`, `init`, `serve`, `add-language`).
- **`lib/*.mjs`** — plain ESM install-time helpers (`claude-settings`, `config`, `git-hooks`,
  `json-file`, `npm-scripts`). **`bin/install.mjs` / `bin/lint.mjs`** — the `captain-obvious-install`
  and `captain-obvious-lint` bins, shipped as-is (not compiled).
- **`hooks/git/*.mjs`** — the lint hook implementations (`lint-comments`, `lint-naming`, `lint-dup*`,
  `lint-solid-*`, `lint-empty-catch`, `lint-sync-calls`, `lint-frozen-interfaces`, `lint-prettier`,
  metrics + ratchets) with vitest `__tests__/`. **`hooks/claude/*.sh`** — the Claude Code guard hooks
  (`main-branch-guard`, `pre-merge-ci-guard`, `stop-unmerged-guard`, `dispatch-guard`, session status).
- **`db/schema.sql`** — registry schema. **`web/dist/`** — the prebuilt control-panel bundle (see below).
- Node ≥ 18, ESM (`"type": "module"`). Commands: `npm test` (`vitest run --coverage` — covers both
  `.ts` and `.mjs` tests and enforces 100% coverage via `vitest.config.ts` thresholds; thin shims are
  excluded there), `npm run build` / `npm run prepare` (`tsc`, emits `dist/`). There is **no CI workflow,
  no typecheck-only script, and no self-applied config** — a green `vitest` + a clean `tsc` are the
  only automated gates. (`main` is branch-protected by `.github/rulesets/main.json`.)

## Domain model — rules check, actions fix

A **rule performs the CHECK** (detection); its **actions handle remediation/output**. A rule may have
zero actions. Actions live in the `fixes` table (one rule → 0..N), `kind`: `script` (deterministic fix
command), `inferred` (fix delegated to the model), `output` (report-only). This is **separate from
`rule_actions`** — the per-environment severity bindings (`warn` / `halt` / `delay_halt`) the web panel
reads. Do not conflate the two. Seed actions via `RuleMeta.actions` (`undefined` = leave untouched on
re-seed, `[]` = clear); CRUD in `src/db/fixes.ts`.

## Web control panel — additive API only

`web/dist` is a **prebuilt bundle with NO source in this repo** and cannot be modified. So every change
to `/api/*` must be **additive and ignorable** by the panel — never rename or drop a field/route it
consumes. It is committed and shipped (un-ignored in `.gitignore`, listed in `package.json` "files")
and served by `captain-obvious serve` (default port 4317).

## Engineering rules

- **Surface errors immediately.** Throw on unexpected/invariant conditions; no
  `try { … } catch { return default }` soft fallbacks; never log an error and continue. `?.` is for
  genuinely-optional fields only — missing-means-malformed should throw.
- **Async filesystem I/O.** `node:fs/promises` in `lib/`; `await access(p).then(() => true, () => false)`
  for existence. **Exception:** the registry uses `better-sqlite3`, whose API is synchronous by
  design — SQLite calls are sync and that is the house style, not a violation.
- **No empty/comment-only catch.** Rethrow, narrow to the recoverable error, or use the API's own
  opt-out (`rm({ force: true })`). Tests assert throws with vitest (`expect().toThrow`), not a try/catch.
- **DRY on the second copy.** Extract a shared helper the second time you'd write the same
  function/constant/regex — including duplicates already in a file you touch.
- **Comments explain why, not what.** Delete comments that restate the code; keep ones that carry a
  tradeoff or non-obvious constraint. No multi-line `//` blocks or banner comments.
- **Naming.** PascalCase for type-likes; camelCase for values; UPPER_SNAKE for constants. Never
  `snake_case` a local — rename the local, keep the wire/DB column key.
- **Fix root causes.** No retries, `.skip`, fallbacks, or "click twice" workarounds.
- **Honesty.** Claim a behavior works/breaks only after running the real path (the actual vitest run,
  the CLI against a real DB) — reading code is a hypothesis. Quote the actual error; "verified" ≠
  "appears to work"; surface bugs the moment you find them, not in a wrap-up footnote.
- **Warnings are errors.** A `tsc`/`vitest`/`npm` warning you can't explain is an undiagnosed failure —
  fix it at the source, don't silence it.
- **Refactoring.** Prefer the clean rewrite in the shape the code should be over the minimal diff that
  preserves the old shape; match surrounding *style*, not old structure.
- **Scratch scripts** go in `.claude/tmp/` (gitignored) — never the repo root or `scripts/`.

## Merge flow

Locally green → commit → push → PR → `gh pr merge --squash --delete-branch`, same turn. **The merge
gate is `npm test` + `tsc` passing locally** (`main` has no required status checks and there is no CI) —
run both before pushing and never push a red tree. Once the PR is open, squash-merge it immediately;
don't arm `--auto`, don't poll. `main` is branch-protected, so any edit starts from a branch
(`git worktree add -b <branch> .worktrees/<slug> main`); don't give the user guidance for changes that
aren't merged to `main` yet.

**After merging, show it.** As the final step of any task that changes the control panel or its
`/api/*`, make the result visible on the dev server without being asked: once the change is on `main`,
rebuild (`npm run build`), free the port if a stale instance holds it
(`lsof -ti tcp:4317 | xargs -r kill`), then start `node dist/bin/captain-obvious.js serve`
(http://127.0.0.1:4317) and confirm it responds. A stale `serve` started from a since-removed worktree
serves a broken panel (`/` 404s because its `web/dist` is gone), so always kill-then-restart from the
primary checkout. Note `gh pr merge --delete-branch` can't check out `main` while the primary worktree
holds it — after the squash-merge lands, delete the merged branch by hand from the primary checkout:
`git push origin --delete <branch>` + `git worktree remove <path>` + `git branch -D <branch>`.
