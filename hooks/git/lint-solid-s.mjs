#!/usr/bin/env node
import { runSolidSHook } from "./solid-s-metrics.mjs";
import { isInvokedAsScript } from "./lint-shared.mjs";

export const main = (argv) => runSolidSHook(argv);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`SOLID-S: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
