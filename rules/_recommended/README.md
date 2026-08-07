# @deterministic-code/co-rules-recommended

The full first-party [captain-obvious](https://github.com/deterministic-code/captain-obvious)
rule set as a single install.

This package ships **no rule code**. It only declares every
`@deterministic-code/co-rule-*` rule as a dependency, so installing it pulls the
whole set into `node_modules`, where the engine discovers each one by its
`captain-obvious-rule` keyword — exactly as if you had listed all 31 by hand.

```sh
npm i -D @deterministic-code/captain-obvious @deterministic-code/co-rules-recommended
npx captain-obvious seed-rules   # discovers every bundled rule
```

Prefer à la carte? Skip this package and install only the rules you want:

```sh
npm i -D @deterministic-code/captain-obvious \
  @deterministic-code/co-rule-lint-comments \
  @deterministic-code/co-rule-lint-naming
```

Both paths use the same discovery mechanism; the bundle is only a convenience
aggregator. The per-project registry DB still decides which discovered rules run.
