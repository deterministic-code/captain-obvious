#!/usr/bin/env node
import { runSolidDHook } from "./solid-d-metrics.mjs";
import { isInvokedAsScript } from "./lint-shared.mjs";

export const main = (argv) => runSolidDHook(argv);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`SOLID-D: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
