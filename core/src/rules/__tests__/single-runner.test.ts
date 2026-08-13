import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The single-runner invariant: rules execute in exactly one place, `runner.ts`.
 * Anything else that spawns a rule check/fix would bypass the run.start/run.end
 * logging bracket and reopen the "silent rule run" hole this design closes, so a
 * second spawn site fails the build. git/gh plumbing spawns are not rule runs and
 * are ignored (their context names no rule-runner token).
 */
const RUNNER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "runner.ts",
);
const ROOTS = [
  resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), // core/src
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "hooks"), // core/hooks
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "bin"), // core/bin
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "lib"), // core/lib
];

// The direct spawn indicators, plus the indirect ones a bin/lib helper used to
// reach a check with (building a rules/<slug>/check.mjs path via a scriptFor-style
// helper) — both must route through runner.ts instead.
const RULE_TOKEN =
  /check\.mjs|checkScriptPath|--fix|CO_JSON|CO_RESULT_FD|scriptFor|rules\/[^"']*\.mjs/;
const SPAWN = /\b(spawn|execFile|execFileSync|exec)\s*\(/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === "__tests__" ? [] : walk(p);
    return /\.(ts|mjs)$/.test(d.name) ? [p] : [];
  });
}

describe("single rule runner", () => {
  it("runner.ts is the only module that spawns a rule", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (file === RUNNER || file.endsWith(`${sep}runner.ts`)) continue;
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          if (
            SPAWN.test(line) &&
            RULE_TOKEN.test(lines.slice(i, i + 3).join("\n"))
          ) {
            offenders.push(`${file}:${i + 1} — ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
