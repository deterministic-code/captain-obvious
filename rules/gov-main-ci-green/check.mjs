// Governance rule runner: block work while main CI is red. The check lives in
// check-main-ci-green.mjs; this slug-named module is what the dispatcher spawns
// (rules/<slug>/check.mjs), so it re-exports that check's main (the run-delegation
// contract) and self-invokes it when run directly as a script.
import { isInvokedAsScript } from "@deterministic-code/co-rule-kit/lint-shared";
import { main } from "@deterministic-code/co-rule-kit/check-main-ci-green";

/** @public — imported dynamically by registry.test.ts via hookScriptPath. */
export { main };

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`gov-main-ci-green: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
