import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main as complexityMain } from "../lint-complexity.mjs";
import { main as linesMain } from "../lint-max-lines.mjs";
import { main as paramsMain } from "../lint-max-params.mjs";
import { main as statementsMain } from "../lint-max-statements.mjs";
import { mockProcessIo } from "./test-helpers.mjs";

// Each wrapper's `main` is a one-liner delegating to runMetricHook with a fixed
// metric name. Invoke it against a single clean --files target so the wrapper's
// arrow executes and the metric name is threaded through to a real hook run.
const CLEAN = "export function ok(a) {\n  return a + 1;\n}\n";

describe("lint metric wrappers delegate to runMetricHook", () => {
  let dir;
  let io;
  let clean;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "metric-wrappers-"));
    clean = join(dir, "clean.ts");
    await writeFile(clean, CLEAN, "utf8");
    io = mockProcessIo();
  });
  afterEach(async () => {
    io.restore();
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  test.each([
    ["lint-complexity", complexityMain, "complexity"],
    ["lint-max-lines", linesMain, "max-lines"],
    ["lint-max-params", paramsMain, "max-params"],
    ["lint-max-statements", statementsMain, "max-statements"],
  ])("%s: clean pass writes its OK line", async (script, main, flag) => {
    await main(["node", "hook", "--files", clean]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain(`${script}: no ${flag} violations.`);
  });
});
