#!/usr/bin/env node
import { runFrozenHook } from "../_kit/frozen-interfaces-metrics.mjs";
import { isInvokedAsScript } from "../_kit/lint-shared.mjs";

export const main = (argv) => runFrozenHook(argv);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`FROZEN: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
