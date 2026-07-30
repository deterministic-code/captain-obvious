#!/usr/bin/env node
import { runMetricHook } from "@deterministic-code/co-rule-kit/fn-metrics";
import { isInvokedAsScript } from "@deterministic-code/co-rule-kit/lint-shared";
import { ruleConfig } from "@deterministic-code/co-rule-kit/config-bridge";

export const main = (argv, resolveConfig = ruleConfig) =>
  runMetricHook("params", argv, resolveConfig);

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-max-params: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
