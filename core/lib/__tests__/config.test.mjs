import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadConfig } from "../config.mjs";

describe("config / loadConfig", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("loads the default captain-obvious.config.json from the target dir", async () => {
    const path = join(dir, "captain-obvious.config.json");
    await writeFile(path, JSON.stringify({ gitHooks: {} }), "utf8");
    const result = await loadConfig(dir);
    expect(result.path).toBe(path);
    expect(result.config).toEqual({ gitHooks: {} });
  });

  test("honors an explicit config path over the default location", async () => {
    const path = join(dir, "custom.json");
    await writeFile(path, JSON.stringify({ custom: true }), "utf8");
    const result = await loadConfig(dir, path);
    expect(result.path).toBe(path);
    expect(result.config).toEqual({ custom: true });
  });

  test("throws a helpful message when the config is missing (ENOENT)", async () => {
    await expect(loadConfig(dir)).rejects.toThrow(
      /captain-obvious: no config at .*captain-obvious\.config\.json/,
    );
  });

  test("rethrows non-ENOENT read errors (target is not a directory-resolvable path)", async () => {
    await expect(loadConfig(dir, dir)).rejects.toThrow();
    await expect(loadConfig(dir, dir)).rejects.not.toThrow(/no config at/);
  });

  test("throws on malformed JSON in the config", async () => {
    const path = join(dir, "captain-obvious.config.json");
    await writeFile(path, "{ broken", "utf8");
    await expect(loadConfig(dir)).rejects.toThrow();
  });
});
