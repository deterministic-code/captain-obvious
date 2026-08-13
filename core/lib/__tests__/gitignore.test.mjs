import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DB_DIR_IGNORE,
  ensureDbIgnored,
  removeDbIgnore,
} from "../gitignore.mjs";

describe("gitignore", () => {
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

  describe("removeDbIgnore", () => {
    it("removes the managed block and restores surrounding content", async () => {
      const dir = await tempDir();
      await writeFile(join(dir, ".gitignore"), "node_modules\ndist\n");
      await ensureDbIgnored(dir);
      const res = await removeDbIgnore(dir);
      expect(res).toMatchObject({
        changed: true,
        reason: "removed",
        emptied: false,
      });
      expect(await read(dir)).toBe("node_modules\ndist\n");
    });

    it("deletes the file when the managed block was all it held", async () => {
      const dir = await tempDir();
      await ensureDbIgnored(dir); // creates .gitignore with only our block
      const res = await removeDbIgnore(dir);
      expect(res).toMatchObject({
        changed: true,
        reason: "removed",
        emptied: true,
      });
      await expect(read(dir)).rejects.toThrow();
    });

    it("is a no-op when .gitignore is absent", async () => {
      const dir = await tempDir();
      expect(await removeDbIgnore(dir)).toMatchObject({
        changed: false,
        reason: "no-file",
      });
    });

    it("leaves a marker-less .captain-obvious/ line alone", async () => {
      const dir = await tempDir();
      await writeFile(join(dir, ".gitignore"), "dist\n.captain-obvious/\n");
      const res = await removeDbIgnore(dir);
      expect(res).toMatchObject({ changed: false, reason: "not-present" });
      expect(await read(dir)).toBe("dist\n.captain-obvious/\n");
    });

    it("removes a bare marker whose pattern line was deleted by hand", async () => {
      const dir = await tempDir();
      await writeFile(
        join(dir, ".gitignore"),
        "dist\n\n# captain-obvious — local registry + audit DBs\n",
      );
      const res = await removeDbIgnore(dir);
      expect(res).toMatchObject({ changed: true, reason: "removed" });
      expect(await read(dir)).toBe("dist\n");
    });

    it("apply:false previews without writing", async () => {
      const dir = await tempDir();
      await writeFile(join(dir, ".gitignore"), "dist\n");
      await ensureDbIgnored(dir);
      const before = await read(dir);
      const res = await removeDbIgnore(dir, { apply: false });
      expect(res).toMatchObject({ changed: true, reason: "removed" });
      expect(await read(dir)).toBe(before);
    });

    it("apply:false does not delete a would-be-emptied file", async () => {
      const dir = await tempDir();
      await ensureDbIgnored(dir);
      const res = await removeDbIgnore(dir, { apply: false });
      expect(res).toMatchObject({ changed: true, emptied: true });
      expect(await read(dir)).toContain(DB_DIR_IGNORE);
    });

    it("rethrows non-ENOENT read errors", async () => {
      const dir = await tempDir();
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(dir, ".gitignore"));
      await expect(removeDbIgnore(dir)).rejects.toThrow();
    });
  });
});
