#!/usr/bin/env node
import { runSolidIHook } from "@deterministic-code/co-rule-kit/solid-i-metrics";
import { isInvokedAsScript } from "@deterministic-code/co-rule-kit/lint-shared";

export const main = (argv) => runSolidIHook(argv);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`SOLID-I: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
