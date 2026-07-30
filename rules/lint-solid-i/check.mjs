#!/usr/bin/env node
import { runSolidIHook } from "../_kit/solid-i-metrics.mjs";
import { isInvokedAsScript } from "../_kit/lint-shared.mjs";

export const main = (argv) => runSolidIHook(argv);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`SOLID-I: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
