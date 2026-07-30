#!/usr/bin/env node
import { runSolidOHook } from "../_kit/solid-o-metrics.mjs";
import { isInvokedAsScript } from "../_kit/lint-shared.mjs";

export const main = (argv) => runSolidOHook(argv);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`SOLID-O: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
