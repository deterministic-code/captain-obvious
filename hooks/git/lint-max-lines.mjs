#!/usr/bin/env node
import { runMetricHook } from "./fn-metrics.mjs";
import { isInvokedAsScript } from "./lint-shared.mjs";

export const main = (argv) => runMetricHook("lines", argv);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-max-lines: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
