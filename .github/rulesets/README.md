# Branch rulesets

Server-side enforcement for the governance rules in the captain-obvious registry.
These are the only place `gov-require-pr` (and the "require CI green" / "no direct
push to main" policies) can actually be enforced — GitHub applies them, no local
hook can. The registry rows carry the same policy as metadata and point here via
`config.ruleset`.

## `main.json`

Applies to `refs/heads/main`:

| Rule | Registry rule it enforces |
|------|---------------------------|
| `pull_request` (1 approval, stale-dismiss, thread resolution) | `gov-require-pr` |
| `required_status_checks` (`unit`, `integration`, strict / up-to-date) | `gov-main-ci-green` |
| `non_fast_forward` + `deletion` | `gov-no-push-to-main` (blocks force-push / deletion / direct push) |

The `unit` / `integration` check contexts match the blocking jobs in
`hooks/git/check-main-ci-green.mjs` (`BLOCKING_JOBS`) and must be the job names in
the `Tests` workflow.

## Apply

```sh
gh api -X POST repos/deterministic-code/captain-obvious/rulesets \
  --input .github/rulesets/main.json
```

Update an existing ruleset (get its id from `gh api repos/{owner}/{repo}/rulesets`):

```sh
gh api -X PUT repos/deterministic-code/captain-obvious/rulesets/<id> \
  --input .github/rulesets/main.json
```
