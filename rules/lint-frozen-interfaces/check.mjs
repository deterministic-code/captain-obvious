#!/usr/bin/env node
import { runFrozenHook } from "@deterministic-code/co-rule-kit/frozen-interfaces-metrics";
import { isInvokedAsScript } from "@deterministic-code/co-rule-kit/lint-shared";

export const main = (argv) => runFrozenHook(argv);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`FROZEN: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
