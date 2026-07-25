#!/usr/bin/env node
import { runMetricHook } from "./fn-metrics.mjs";
import { isInvokedAsScript } from "./lint-shared.mjs";

export const main = (argv) => runMetricHook("complexity", argv);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-complexity: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
