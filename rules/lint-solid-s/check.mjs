#!/usr/bin/env node
import { runSolidSHook } from "@deterministic-code/co-rule-kit/solid-s-metrics";
import { isInvokedAsScript } from "@deterministic-code/co-rule-kit/lint-shared";

export const main = (argv) => runSolidSHook(argv);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`SOLID-S: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
