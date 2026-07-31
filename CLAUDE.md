## Project

`@deterministic-code/captain-obvious` — deterministic, mechanical lint gates + Claude Code
guard hooks, installable into any repo. The package ships the **hook implementations**; each
consuming repo owns a `captain-obvious.config.json` that decides **which** hooks run, in what
order, and which are advisory — so one package drives a strict repo and a lax one without forking.

The config's optional `"mode"` key (`"local"` | `"global"`, default `local`, overridable by the
`CAPTAIN_OBVIOUS_MODE` env var) picks where the registry + audit DBs live: **local** ties them to the
project (`<repoRoot>/.captain-obvious/`), **global** shares one set machine-wide
(`$XDG_CONFIG_HOME/captain-obvious` or `~/.config/captain-obvious`). Resolved synchronously in
`core/src/db/location.ts`; the explicit `--db`/`CAPTAIN_OBVIOUS_DB` (and audit equivalents) still win.
The panel's top-right badge (via `GET /api/mode`) shows which is active.

The repo is an **npm workspaces monorepo**: the root is a private host; the engine and every rule
are workspace packages. Dependency DAG: **rule package → `rules/_kit` → `core`**, all by package name.

- **`rules/<slug>/`** — each rule is its **own npm package** `@deterministic-code/co-rule-<slug>`
  (see "Rule plugins" below): `plugin.mjs` (the `RulePlugin` descriptor: meta, settings control,
  dependencies, `checkEntry`), `check.mjs` (the un-compiled runner the dispatcher spawns), an optional
  `control.mjs`, and a `package.json` declaring its deps (the kit + any tool). Shared check helpers are
  the **`rules/_kit/`** package `@deterministic-code/co-rule-kit` (`lint-shared`, `fn-metrics`,
  `solid-*-metrics`, `dup-*`, `ast-fingerprint`, and the `config-bridge`/`protected-globs` bridges that
  import the core runtime by name). Vitest lives flat in **`rules/__tests__/`**.
- **`core/`** — the engine package `@deterministic-code/captain-obvious`. `core/src/` is strict
  TypeScript compiled to `core/dist/` by `tsc`:
  - `core/src/db/` — the SQLite catalog via `better-sqlite3` (`open`, `rules`, `fixes`, `actions`,
    `languages`, `seed`, `lookups`, `types`, `args`).
  - `core/src/rules/` — the plugin engine: `plugin.ts` (the `RulePlugin` interface), `load.ts` (hybrid
    discovery — the `plugins[]` list in `captain-obvious.config.json` plus a folder-scan for
    not-yet-packaged rules; stamps each plugin's absolute `checkPath`), `index.ts`
    (`RULES = await loadPlugins()`), `config.ts` (per-rule config for the check bridge), `deps.ts`
    (dependency verification), `dispatch.ts`, `stages.ts`, `languages.ts`, `types.ts`.
  - `core/src/server/` — the web control panel: `serve.ts` (routing + static SPA), `registry.ts`
    (shapes `/api/*`), `profiling.ts`. `core/src/bin/captain-obvious.ts` — the CLI (`add-rule`,
    `configure-rule`, `configure-action`, `seed-rules`, `check-deps`, `show-rule`, `init`, `serve`,
    `add-language`).
  - `core/lib/*.mjs` — install-time helpers. `core/bin/install.mjs` / `core/bin/lint.mjs` — the
    `captain-obvious-install` / `captain-obvious-lint` bins, shipped as-is. `core/hooks/git/dispatch.mjs`
    — the thin git-hook entry that spawns each rule's `check.mjs`; `core/hooks/claude/*.sh` — the Claude
    Code guard hooks. `core/db/schema.sql` — registry schema. `core/web/dist/` — the prebuilt panel.
  - The core publishes runtime subpaths for the kit's bridges: `./runtime/db`, `./runtime/config`,
    `./runtime/protected-paths`, `./languages`.
- Node ≥ 18, ESM. Commands from the **repo root**: `npm test` (`vitest run --coverage` — covers
  `core/src`/`core/hooks`/`core/lib` + all `rules/*` `.mjs`, 100% enforced), `npm run build`
  (`tsc -p core/tsconfig.json`, emits `core/dist/`). There is **no CI** — a green `vitest` + clean `tsc`
  are the only automated *merge* gates.
  The repo now **self-applies its own hooks** via `captain-obvious.config.json` (run
  `captain-obvious-install` after clone to wire the local `.git/hooks` + Claude guards); those hooks are
  local, best-effort, and driven by the local registry DB, not a substitute for the vitest + tsc gate.
  (`main` is branch-protected by `.github/rulesets/main.json`.)

## Domain model — rules check, actions fix

A **rule performs the CHECK** (detection); its **actions handle remediation/output**. A rule may have
zero actions. Actions live in the `fixes` table (one rule → 0..N), `kind`: `script` (deterministic fix
command), `inferred` (fix delegated to the model), `output` (report-only). This is **separate from
`rule_actions`** — the per-environment action bindings (`warn` / `halt` / `delay_halt`) the web panel
reads. Do not conflate the two. Seed actions via `RulePluginMeta.actions` (`undefined` = leave untouched
on re-seed, `[]` = clear); CRUD in `src/db/fixes.ts`.

## Rule plugins — one folder, one rule

Every rule is a self-contained module under `rules/<slug>/`, conforming to the `RulePlugin` interface
(`src/rules/plugin.ts`). Setup discovers them by scanning the folder — drop a new `rules/<slug>/plugin.mjs`
and it registers itself; there is no central list to edit.
- **`plugin.mjs`** — a plain-ESM descriptor (JSDoc-typed against `RulePlugin`, *not* tsc-compiled, like
  the checks) default-exporting `{ meta, control?, dependencies?, checkEntry }`. `load.ts` validates each
  (`assertRulePlugin`) and `registerRule` (`src/db/rules.ts`) writes it to the catalog (languages,
  categories, stages, fixes, `control_json`, `deps_json`).
- **`check.mjs`** — the check, spawned un-compiled by `dispatch.ts` via `checkEntry`. It reads its
  effective config (global overlaid by the default project) through `rules/_shared/config-bridge.mjs` →
  `src/rules/config.ts`, so a panel edit to a threshold reaches the running check. `checkEntry: null`
  marks a policy-only rule with no local runner (e.g. `gov-require-pr`).
- **`control`** — the settings dialog: `{ kind: "declarative", fields }` (rendered generically by
  `panelExt`) or `{ kind: "custom", key }` (the escape hatch resolving to `panelExt`'s `CUSTOM_CONTROLS`).
- **`dependencies`** — external tools/packages the check needs; `check-deps` (and install) warn if any
  are missing (`src/rules/deps.ts`, warn-only).

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
