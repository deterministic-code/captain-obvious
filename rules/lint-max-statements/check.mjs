#!/usr/bin/env node
import { runMetricHook } from "../_kit/fn-metrics.mjs";
import { isInvokedAsScript } from "../_kit/lint-shared.mjs";
import { ruleConfig } from "../_kit/config-bridge.mjs";

export const main = (argv, resolveConfig = ruleConfig) =>
  runMetricHook("statements", argv, resolveConfig);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-max-statements: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
