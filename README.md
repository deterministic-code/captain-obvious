# @deterministic-code/captain-obvious

Deterministic, mechanical hooks — the ones that reject the obvious stuff (sync I/O,
empty catches, multi-line comments, structural duplication, arg-creep on frozen
interfaces, naming drift) before it ever reaches review — plus the Claude Code guard
hooks that keep an agent off `main` and off a red tree.

The package ships the **hook implementations**. Each consuming repo owns a
`captain-obvious.config.json` that says **which** hooks run, in what order, and which
are advisory — so the same package drives a strict repo and a lax one without forking.

## Install

```sh
npm install --save-dev @deterministic-code/captain-obvious
npx captain-obvious-install
```

Wire it to run on every `npm install` so a fresh clone is gated automatically:

```json
{
  "scripts": {
    "prepare": "captain-obvious-install"
  }
}
```

`captain-obvious-install` reads `captain-obvious.config.json` from the repo root
(override with `--config <path>`, or the repo root with `--target <dir>`) and owns all
the reference wiring so you never hand-edit it:

- writes `.git/hooks/pre-commit` and `pre-push` that invoke the configured lint hooks
  from their installed location,
- merges the configured Claude hooks into `.claude/settings.json` (idempotently — it
  only ever rewrites entries it previously added, tagged `_captainObvious`), and
- rewrites the `lint:*` scripts in your `package.json` to run through the package's
  `captain-obvious-lint` bin, tracking the keys it owns under `captainObvious.managedScripts`
  so re-runs stay idempotent and dropped hooks get pruned.

Run any hook directly with the bin: `captain-obvious-lint <name> --staged` (e.g.
`captain-obvious-lint comments --staged` runs `hooks/git/lint-comments.mjs`).

## Config

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
    { "event": "PreToolUse", "matcher": "Edit|Write", "hook": "main-branch-guard", "timeout": 5 },
    { "event": "Stop", "hook": "stop-unmerged-guard", "timeout": 15 }
  ]
}
```

- **Each `gitHooks` entry is `<hook-name> <args>`** — the first token names a script in
  `hooks/git/` (drop the `.mjs`), the rest are its flags.
- **`run: <command>`** passes a shell command through verbatim (e.g. your test tiers).
- **`--warn` makes an entry advisory** — its output prints but never fails the hook.
  Everything else is blocking (`|| exit 1`).
- **Each `claudeHooks` entry** names a script in `hooks/claude/` (drop the `.sh`), the
  Claude event, an optional tool `matcher`, and a `timeout` in seconds.
- **`npmScripts.extraScripts`** (optional, `key → bin args`) adds or overrides managed
  aliases for the odd modes — e.g. `"lint:dead-code": "dead-code --all"` or
  `"lint:frozen-interfaces:add": "frozen-interfaces --add"`. Set `npmScripts.enabled:
  false` to skip package.json rewriting entirely.

## What's in the box

`hooks/git/` — the lint gate (`lint-comments`, `lint-empty-catch`, `lint-sync-calls`,
`lint-naming`, `lint-max-lines`/`-statements`/`-params`, `lint-complexity`,
`lint-frozen-interfaces`, `lint-emitter-casing`, `lint-dead-code`, `lint-dup`/`-fn`/
`-structural`, `lint-test-disabling-skipping`, `lint-solid-{s,d,i,l,o}`, and their
metric helpers).

`hooks/claude/` — `dispatch-guard`, `main-branch-guard`, `pre-merge-ci-guard`,
`stop-unmerged-guard`, `session-main-ci-status`.
