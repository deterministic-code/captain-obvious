#!/usr/bin/env node
import { runSolidLHook } from "@deterministic-code/co-rule-kit/solid-l-metrics";
import { isInvokedAsScript } from "@deterministic-code/co-rule-kit/lint-shared";

export const main = (argv) => runSolidLHook(argv);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`SOLID-L: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
