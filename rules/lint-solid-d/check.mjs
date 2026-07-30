#!/usr/bin/env node
import { runSolidDHook } from "@deterministic-code/co-rule-kit/solid-d-metrics";
import { isInvokedAsScript } from "@deterministic-code/co-rule-kit/lint-shared";

export const main = (argv) => runSolidDHook(argv);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`SOLID-D: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
