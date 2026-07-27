import { rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { defineRule } from "../define.js";
import { nameFor } from "../languages.js";
import type { RuleMeta } from "../types.js";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// A unique slug so the fixture hook never collides with a bundled rule; the
// `run` path resolves hooks/git/<slug>.mjs relative to pkgRoot, so the fixture
// must live there for the dynamic import to find it.
const FIXTURE_SLUG = `define-test-fixture-${process.pid}`;
const fixtureHook = resolve(pkgRoot, "hooks", "git", `${FIXTURE_SLUG}.mjs`);

function meta(slug: string): RuleMeta {
  return {
    slug,
    name: "Fixture",
    category: "governance",
    description: "test fixture",
    languages: [],
    config: null,
    ratchetable: false,
    modes: [],
    stage: "pre-commit",
  };
}

afterEach(async () => {
  await rm(fixtureHook, { force: true });
});

describe("defineRule", () => {
  it("carries the metadata through unchanged", () => {
    const rule = defineRule(meta("some-slug"));
    expect(rule.meta.slug).toBe("some-slug");
    expect(typeof rule.run).toBe("function");
  });

  it("run delegates to hooks/git/<slug>.mjs main(argv)", async () => {
    // The hook records the argv it was handed so we can prove `run` forwards it.
    await writeFile(
      fixtureHook,
      "globalThis.__defineTestArgv = undefined;\n" +
        "export async function main(argv) { globalThis.__defineTestArgv = argv; }\n",
      "utf8",
    );
    const rule = defineRule(meta(FIXTURE_SLUG));
    await rule.run(["--all", "x.ts"]);
    expect((globalThis as Record<string, unknown>).__defineTestArgv).toEqual([
      "--all",
      "x.ts",
    ]);
  });

  it("run rejects when the hook module is missing", async () => {
    const rule = defineRule(meta("no-such-hook-slug"));
    await expect(rule.run([])).rejects.toThrow();
  });
});

describe("nameFor", () => {
  it("returns the display name for a known language slug", () => {
    expect(nameFor("typescript")).toBe("TypeScript");
  });

  it("falls back to the slug itself when unknown", () => {
    expect(nameFor("cobol")).toBe("cobol");
  });
});
