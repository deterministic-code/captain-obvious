import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { scaffoldConfig } from "../scaffold-config.mjs";

const SCRATCH = tmpdir();

describe("scaffold-config / scaffoldConfig", () => {
  let target;

  beforeEach(async () => {
    target = await mkdtemp(join(SCRATCH, "scaffold-"));
  });

  afterEach(async () => {
    await rm(target, { recursive: true, force: true });
  });

  test("no-ops when config already exists", async () => {
    const configPath = join(target, "captain-obvious.config.json");
    const original = { custom: true, nested: { key: "value" } };
    await writeFile(configPath, JSON.stringify(original), "utf8");

    const result = await scaffoldConfig({ target, isTTY: false });

    expect(result.created).toBe(false);
    expect(result.path).toBe(configPath);
    const written = JSON.parse(await readFile(configPath, "utf8"));
    expect(written).toEqual(original);
  });

  test("creates config with all defaults when non-interactive", async () => {
    const input = new PassThrough();
    const result = await scaffoldConfig({ target, input, isTTY: false });

    expect(result.created).toBe(true);
    const written = JSON.parse(await readFile(result.path, "utf8"));
    expect(written).toEqual({
      gitHooks: {},
      claudeHooks: [
        {
          event: "PreToolUse",
          matcher: "Edit|Write",
          hook: "main-branch-guard",
          timeout: 5,
        },
        { event: "Stop", hook: "stop-unmerged-guard", timeout: 15 },
      ],
    });
    expect(written.mode).toBeUndefined();
  });

  test("returns { path, created: true } when scaffolding succeeds", async () => {
    const result = await scaffoldConfig({ target, isTTY: false });
    expect(result).toHaveProperty("path");
    expect(result).toHaveProperty("created", true);
    expect(result.path).toBe(join(target, "captain-obvious.config.json"));
  });

  test("writes valid JSON with 2-space indentation", async () => {
    await scaffoldConfig({ target, isTTY: false });
    const content = await readFile(
      join(target, "captain-obvious.config.json"),
      "utf8",
    );
    expect(content).toContain("  ");
    expect(() => JSON.parse(content)).not.toThrow();
  });
});
