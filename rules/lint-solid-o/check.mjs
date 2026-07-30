#!/usr/bin/env node
import { runSolidOHook } from "@deterministic-code/co-rule-kit/solid-o-metrics";
import { isInvokedAsScript } from "@deterministic-code/co-rule-kit/lint-shared";

export const main = (argv) => runSolidOHook(argv);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`SOLID-O: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
