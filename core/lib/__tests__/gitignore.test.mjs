import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DB_DIR_IGNORE, ensureDbIgnored } from "../gitignore.mjs";

describe("gitignore / ensureDbIgnored", () => {
  const dirs = [];

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  async function tempDir() {
    const dir = await mkdtemp(join(tmpdir(), "co-gitignore-"));
    dirs.push(dir);
    return dir;
  }

  const read = (dir) => readFile(join(dir, ".gitignore"), "utf8");

  it("creates .gitignore when absent", async () => {
    const dir = await tempDir();
    const res = await ensureDbIgnored(dir);
    expect(res).toMatchObject({
      existed: false,
      changed: true,
      reason: "created",
    });
    const text = await read(dir);
    expect(text).toContain(DB_DIR_IGNORE);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("appends to an existing file with a blank-line separator", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, ".gitignore"), "node_modules\ndist\n");
    const res = await ensureDbIgnored(dir);
    expect(res).toMatchObject({
      existed: true,
      changed: true,
      reason: "updated",
    });
    const text = await read(dir);
    expect(text).toBe(
      `node_modules\ndist\n\n# captain-obvious — local registry + audit DBs\n${DB_DIR_IGNORE}\n`,
    );
  });

  it("appends without a leading blank line when the file is empty", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, ".gitignore"), "\n\n");
    const res = await ensureDbIgnored(dir);
    expect(res.reason).toBe("updated");
    expect((await read(dir)).startsWith("# captain-obvious")).toBe(true);
  });

  it("is a no-op when the dir is already ignored (trailing slash)", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, ".gitignore"), "foo\n.captain-obvious/\nbar\n");
    const res = await ensureDbIgnored(dir);
    expect(res).toMatchObject({ changed: false, reason: "present" });
    expect(await read(dir)).toBe("foo\n.captain-obvious/\nbar\n");
  });

  it("treats every covering spelling as already ignored", async () => {
    for (const pattern of [
      ".captain-obvious",
      "/.captain-obvious",
      "/.captain-obvious/",
      "  .captain-obvious/  ",
    ]) {
      const dir = await tempDir();
      await writeFile(join(dir, ".gitignore"), `${pattern}\n`);
      expect((await ensureDbIgnored(dir)).reason).toBe("present");
    }
  });

  it("ignores commented and blank lines when checking", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, ".gitignore"), "# .captain-obvious/\n\ndist\n");
    expect((await ensureDbIgnored(dir)).reason).toBe("updated");
  });

  it("apply:false previews the change without writing", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, ".gitignore"), "dist\n");
    const res = await ensureDbIgnored(dir, { apply: false });
    expect(res).toMatchObject({ changed: true, reason: "updated" });
    expect(await read(dir)).toBe("dist\n");
  });

  it("apply:false on an absent file reports created without writing", async () => {
    const dir = await tempDir();
    const res = await ensureDbIgnored(dir, { apply: false });
    expect(res).toMatchObject({ existed: false, reason: "created" });
    await expect(read(dir)).rejects.toThrow();
  });

  it("rethrows non-ENOENT read errors", async () => {
    const dir = await tempDir();
    // A directory at the .gitignore path makes readFile fail with EISDIR, not ENOENT.
    await mkdtemp(join(dir, "x-"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, ".gitignore"));
    await expect(ensureDbIgnored(dir)).rejects.toThrow();
  });
});
