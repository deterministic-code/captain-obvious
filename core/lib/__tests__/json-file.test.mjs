import {
  mkdtemp,
  rm,
  writeFile,
  chmod,
  stat,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readJson, writeJson } from "../json-file.mjs";

const SCRATCH =
  "/private/tmp/claude-501/-Users-ryan-Projects-captain-obvious/21d816db-ca11-437f-a0f2-ca45be7dd636/scratchpad";

describe("json-file", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(SCRATCH, "json-file-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("readJson returns parsed content of an existing file", async () => {
    const path = join(dir, "data.json");
    await writeFile(path, JSON.stringify({ a: 1, b: [2, 3] }), "utf8");
    expect(await readJson(path)).toEqual({ a: 1, b: [2, 3] });
  });

  test("readJson returns the default fallback ({}) when the file is missing", async () => {
    expect(await readJson(join(dir, "missing.json"))).toEqual({});
  });

  test("readJson returns an explicit fallback when the file is missing", async () => {
    const fallback = { seeded: true };
    expect(await readJson(join(dir, "missing.json"), fallback)).toBe(fallback);
  });

  test("readJson rethrows non-ENOENT errors (reading a directory as a file)", async () => {
    await expect(readJson(dir)).rejects.toThrow();
  });

  test("readJson throws on malformed JSON", async () => {
    const path = join(dir, "bad.json");
    await writeFile(path, "{ not json", "utf8");
    await expect(readJson(path)).rejects.toThrow();
  });

  test("writeJson writes pretty-printed JSON with a trailing newline", async () => {
    const path = join(dir, "out.json");
    await writeJson(path, { x: 1 });
    expect(await readFile(path, "utf8")).toBe(`{\n  "x": 1\n}\n`);
  });

  test("writeJson creates missing parent directories", async () => {
    const path = join(dir, "nested", "deep", "out.json");
    await writeJson(path, { ok: true });
    expect(await readJson(path)).toEqual({ ok: true });
  });

  test("readJson round-trips a value written by writeJson", async () => {
    const path = join(dir, "round.json");
    const value = { list: [1, 2], nested: { k: "v" } };
    await writeJson(path, value);
    expect(await readJson(path)).toEqual(value);
  });
});
