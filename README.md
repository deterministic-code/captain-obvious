# @deterministic-code/captain-obvious

Deterministic, mechanical hooks — the ones that reject the obvious stuff (sync I/O,
empty catches, multi-line comments, structural duplication, arg-creep on frozen
interfaces, naming drift) before it ever reaches review — plus the Claude Code guard
hooks that keep an agent off `main` and off a red tree.

The package is the **engine + Claude guard hooks** — a plugin host. The lint rules
themselves are **separate npm packages** you install à la carte; the engine discovers
any installed package that opts in (see below) and the per-project registry DB says
**which** of them run, in what order, and which are advisory — so the same engine drives
a strict repo and a lax one without forking.

## Install

Install the engine, then whichever rule packages you want. The engine alone ships **no
rules** — a minimal install is exactly the rules you ask for:

```sh
npm install --save-dev @deterministic-code/captain-obvious
npm install --save-dev \
  @deterministic-code/co-rule-lint-comments \
  @deterministic-code/co-rule-lint-naming
npx captain-obvious-install
```

Want the whole first-party set in one line instead of naming rules individually? Install
the bundle — it depends on every `co-rule-*` rule, so they all land in `node_modules` and
get discovered the same way:

```sh
npm install --save-dev @deterministic-code/captain-obvious @deterministic-code/co-rules-recommended
npx captain-obvious-install
```

`captain-obvious-install` scaffolds `captain-obvious.config.json` if it doesn't exist,
asking you two quick questions (DB mode, and whether to wire the git + Claude Code guard
hooks) with sensible defaults; then it wires the hooks, merges Claude Code settings,
rewrites npm scripts, and initializes + seeds the registry DB in one shot. On a fresh clone
with a committed config, it runs non-interactively in your `prepare` script; on a new
consumer repo, it prompts once and produces a working gate immediately.

Skip the prompts with flags — handy for scripted installs: `--yes` (or `-y`) takes every
default without asking, `--mode <local|global>` pins the DB location, and `--no-hooks`
scaffolds without wiring any hooks. A pinned flag is never prompted for, so `--mode global`
still asks about hooks but not the mode. A non-TTY stdin (CI, `prepare`) implies `--yes`.

Rules are discovered from `node_modules`: any installed package whose `package.json`
carries the `"captain-obvious-rule"` keyword is picked up and seeded into the registry —
so a rule can live in **any package, any scope, any repo**, including one you publish
yourself. The bundle is only a convenience aggregator over that same mechanism.

Wire it to run on every `npm install` so a fresh clone is gated automatically:

```json
{
  "scripts": {
    "prepare": "captain-obvious-install"
  }
}
```

`captain-obvious-install` owns all the reference wiring so you never hand-edit it:

- scaffolds `captain-obvious.config.json` if missing (or skips if `--config` is explicit),
- writes the client-side git hooks (`pre-commit`, `commit-msg`, `pre-merge-commit`,
  `pre-rebase`, `pre-push`) that dispatch the **enabled** rules for each stage from the
  registry DB (plus any `run:` passthroughs) — so toggling a rule in the control panel
  changes what runs with no reinstall. Each hook picks its stage by **who ran git**: the
  Claude-context stage (`pre-commit`, …) when `CLAUDECODE=1` (git invoked by Claude Code),
  the CLI-context stage (`git-pre-commit`, …) for a human terminal — so a repo can lint
  Claude's commits while leaving human commits ungated by default (the `git-*` stages start
  empty; opt human commits in per-rule from the panel),
- merges the configured Claude hooks into `.claude/settings.json` (idempotently — it
  only ever rewrites entries it previously added, tagged `_captainObvious`),
- rewrites the `lint:*` scripts in your `package.json` to run through the package's
  `captain-obvious-lint` bin (plus a `panel` alias, below), tracking the keys it owns under
  `captainObvious.managedScripts` so re-runs stay idempotent and dropped hooks get pruned, and
- initializes and seeds the registry DB so rules are live on the first hook run.

It also **warns loudly if the engine and your rule packages are on `^`-incompatible versions**
(e.g. an old `@deterministic-code/captain-obvious` left pinned while the rules were upgraded) —
the lockstep release keeps everything on one version, so a mismatch means a half-upgraded install.
Fix it by aligning the versions (`npm install @deterministic-code/captain-obvious@latest` and the
matching rules).

Run any hook directly with the bin: `captain-obvious-lint <name> --staged` (e.g.
`captain-obvious-lint comments --staged` runs `hooks/git/lint-comments.mjs`).

### Inspecting installed hooks

`captain-obvious-hooks` lists **every** hook wired into a repo — git hooks and Claude Code
guard hooks — flagging which captain-obvious installed (`captain-obvious`) and which came from
elsewhere (`external`, e.g. husky, lefthook, or a hand-written hook):

```sh
npx captain-obvious-hooks            # inspect the current repo
npx captain-obvious-hooks --target ../other-repo
npx captain-obvious-hooks --json     # machine-readable inventory
```

```
git hooks (/repo/.git/hooks):
  commit-msg         captain-obvious
  post-checkout      external
  pre-commit         captain-obvious
  pre-merge-commit   captain-obvious
  pre-push           captain-obvious
  pre-rebase         captain-obvious

Claude Code hooks (/repo/.claude/settings.json):
  PreToolUse   Edit|Write   captain-obvious
  Stop         *            captain-obvious
```

It honors `core.hooksPath` (so husky/lefthook hooks show up), skips git's `*.sample` stubs, and
flags any hook that isn't executable (git silently skips those). It reads only — it never
changes anything.

### Uninstalling

`captain-obvious-hooks uninstall` removes every hook captain-obvious installed — the managed git
hooks, the `_captainObvious`-tagged entries in `.claude/settings.json`, and the managed `lint:*` /
`panel` aliases in `package.json` — and leaves hand-authored hooks and scripts untouched. It only
ever removes what it wrote (detected by the same markers `list` uses):

```sh
npx captain-obvious-hooks uninstall            # dry run — prints what it would remove
npx captain-obvious-hooks uninstall --yes      # actually remove them
```

`captain-obvious-uninstall` goes one step further: it removes the hooks **and** the local
registry + audit DBs (`<repo>/.captain-obvious/`). It leaves `captain-obvious.config.json` in place
so a re-install is one command; delete that by hand for zero trace, then `npm rm
@deterministic-code/captain-obvious`. Global-mode data (`mode: "global"`) is shared machine-wide, so
it is reported but never auto-deleted:

```sh
npx captain-obvious-uninstall                  # dry run
npx captain-obvious-uninstall --yes            # remove hooks + local .captain-obvious/ data
```

Both default to a dry run and require `--yes` to touch anything; both accept `--target <dir>`.

## Control panel

Configure rules (enable/disable, thresholds, advisory-vs-blocking, order) and view Activity
from the web panel. Install wires a managed `panel` script, so:

```sh
npm run panel                 # → captain-obvious serve, then open http://127.0.0.1:4317
```

or invoke the bin directly, e.g. on another port: `npx captain-obvious serve --port 5000`.
The panel edits and reads the same registry + audit DBs the git hooks use, so changes take
effect on the next hook run with no reinstall; its top-right badge shows the active `mode`
(where those DBs live). Rename the alias with `npmScripts.panelScript: "co:panel"` if `panel`
collides with one of yours, or drop it with `npmScripts.panelScript: false`.

## Config

`captain-obvious-install` scaffolds `captain-obvious.config.json` on first run, asking two
questions (DB mode, and whether to wire the git + Claude Code guard hooks) and filling in
sensible defaults. You don't need to hand-author it — the scaffolding picks good defaults and
you can customize afterward if needed:

```json
{
  "gitHooks": {
    "preCommit": [
      "lint-comments --staged",
      "lint-naming --staged",
      "lint-solid-s --staged --warn"
    ],
    "prePush": [
      "lint-dup --push",
      "lint-dup-fn --push --warn",
      "run: npm run test:unit"
    ]
  },
  "claudeHooks": [
    {
      "event": "PreToolUse",
      "matcher": "Edit|Write",
      "hook": "main-branch-guard",
      "timeout": 5
    },
    { "event": "Stop", "hook": "stop-unmerged-guard", "timeout": 15 }
  ]
}
```

- **Which rules run is driven by the registry, not this config.** Each git hook dispatches
  the rules that are `enabled` for its stage from the DB; enable or disable a rule in the
  control panel and the change takes effect on the next hook run. Every git hook has two
  stages — a Claude-context stage (`pre-commit`, `commit-msg`, `pre-merge-commit`,
  `pre-rebase`, `pre-push`) dispatched when `CLAUDECODE=1`, and a `git-`prefixed CLI-context
  stage (`git-pre-commit`, …) for human commits — so a rule can be assigned to run for
  Claude, for the CLI, or both. Advisory-vs-blocking is likewise a per-rule binding in the
  panel (a default `warn` action makes a rule advisory), not a config flag.
- **Each `gitHooks` entry is `<hook-name> <args>`** — these entries no longer select what the
  git hooks run; they drive the managed `lint:*` npm aliases (see `npmScripts` below) so you
  can invoke a hook by hand.
- **`run: <command>`** passes a shell command through verbatim into the git hook (e.g. your
  test tiers), after the rule dispatch line. Blocking (`|| exit 1`). Attach passthroughs to a
  hook by its config key: `preCommit`, `commitMsg`, `preMergeCommit`, `preRebase`, `prePush`.
  Passthroughs run in both contexts (they're explicit repo commands, not context-split rules).
- **Each `claudeHooks` entry** names a script in `hooks/claude/` (drop the `.sh`), the
  Claude event, an optional tool `matcher`, and a `timeout` in seconds.
- **`npmScripts.extraScripts`** (optional, `key → bin args`) adds or overrides managed
  aliases for the odd modes — e.g. `"lint:dead-code": "dead-code --all"` or
  `"lint:frozen-interfaces:add": "frozen-interfaces --add"`. Set `npmScripts.enabled:
false` to skip package.json rewriting entirely.
- **`npmScripts.panelScript`** (optional) renames the managed control-panel alias (default
  `panel` → `captain-obvious serve`); set it to `false` to skip that alias.

### Advanced: scripted registry management

`captain-obvious-install` initializes and seeds the registry in one shot. For scripted or
advanced use cases (e.g. re-seeding after installing a new rule package without touching hooks
or settings), use the standalone CLI commands:

- `captain-obvious init` — create the registry DB file.
- `captain-obvious seed-rules [--only <slug>]` — populate or refresh the registry from
  discovered rules.

## What's in the box

This package is the **engine**: the git-hook dispatcher, the `captain-obvious` /
`-install` / `-lint` bins, the registry DB + control panel, and the Claude guard hooks
(`hooks/claude/` — `main-branch-guard`, `protected-paths-guard`, `stop-unmerged-guard`,
`tool-fix`, …). It ships **no lint rules**.

The rules are the `@deterministic-code/co-rule-*` packages — `lint-comments`,
`lint-naming`, `lint-max-lines`/`-statements`/`-params`, `lint-complexity`,
`lint-frozen-interfaces`, `lint-emitter-casing`, `lint-dead-code`, `lint-dup`/`-fn`/
`-structural`, `lint-test-disabling-skipping`, `lint-solid-{s,d,i,l,o}`, and the
`gov-*` policy rules. Install the ones you want; each declares its own deps (the shared
`@deterministic-code/co-rule-kit` and any tool it drives) and is discovered by the
`"captain-obvious-rule"` keyword.
