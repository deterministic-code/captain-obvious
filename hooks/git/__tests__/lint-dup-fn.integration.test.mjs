import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { main } from "../lint-dup-fn.mjs";
import {
  cleanupTmp,
  commitAllIn,
  gitIn,
  makeTempGitRepo,
  markCurrentAsOriginMain,
  mockProcessIo,
} from "./test-helpers.mjs";

// A ≥14-node named body; two differently-named copies form a function-clone cluster.
const FN_A = `export function normalizeUserRecordForStorage(record) {
  const trimmedName = String(record.name).trim().toLowerCase();
  const normalizedEmail = String(record.email).trim().toLowerCase();
  const createdAtMs = new Date(record.createdAt).getTime();
  return { trimmedName, normalizedEmail, createdAtMs, active: true };
}`;

const FN_B = FN_A.replace(
  "normalizeUserRecordForStorage",
  "normalizeVendorRecordForStorage",
);

/** In-process main() runs against the temp repo by chdir'ing into it — v8 only
 * instruments this process, so subprocess runners would not count for coverage. */
describe("lint-dup-fn / main dispatch (in-process)", () => {
  let repo;
  let io;
  let cwd;

  beforeEach(async () => {
    repo = await makeTempGitRepo("lint-dup-fn-");
    cwd = process.cwd();
    process.chdir(repo);
    io = mockProcessIo();
  });

  afterEach(async () => {
    io.restore();
    process.chdir(cwd);
    await cleanupTmp(repo);
  });

  async function seedTwoCloneFiles() {
    await writeFile(join(repo, "userstore.mjs"), `${FN_A}\n`);
    await writeFile(join(repo, "vendorstore.mjs"), `${FN_B}\n`);
  }

  test("--push flags a newly-introduced duplicate function body and exits 1", async () => {
    await writeFile(join(repo, "userstore.mjs"), `${FN_A}\n`);
    await commitAllIn(repo, "baseline: single helper");
    await markCurrentAsOriginMain(repo);

    await writeFile(join(repo, "vendorstore.mjs"), `${FN_B}\n`);
    await commitAllIn(repo, "add a duplicate helper");

    await expect(main(["node", "s", "--push"])).rejects.toThrow(/__exit__:1/);
    const err = io.text(io.stderrSpy);
    expect(err).toContain("newly-introduced duplicate function body");
    expect(err).toContain("vendorstore.mjs");
  });

  // A rename in the push range drives collectAddedRanges' rename map + oldPath
  // pathspec: the moved file with pre-existing internal duplication is NOT new.
  test("--push is rename-aware: a pure git-mv of a pre-duplicated file is not flagged", async () => {
    const both = `${FN_A}\n\nconst sep = 1;\n\n${FN_B}\n`;
    await writeFile(join(repo, "store.mjs"), both);
    await commitAllIn(repo, "baseline: two clones in one file");
    await markCurrentAsOriginMain(repo);

    await gitIn(repo, ["mv", "store.mjs", "renamed-store.mjs"]);
    await commitAllIn(repo, "rename only");

    await main(["node", "s", "--push"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain(
      "no newly-introduced duplicate function bodies",
    );
  });

  test("--push with --warn prints the advisory banner and exits 0", async () => {
    await writeFile(join(repo, "userstore.mjs"), `${FN_A}\n`);
    await commitAllIn(repo, "baseline");
    await markCurrentAsOriginMain(repo);
    await writeFile(join(repo, "vendorstore.mjs"), `${FN_B}\n`);
    await commitAllIn(repo, "add duplicate");

    await main(["node", "s", "--push", "--warn"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stderrSpy)).toContain("⚠ lint-dup-fn");
    expect(io.text(io.stderrSpy)).toContain("advisory");
  });

  test("--push skips (exit 0) when origin/main is absent", async () => {
    await seedTwoCloneFiles();
    await commitAllIn(repo, "both clones, but no origin/main ref");

    await main(["node", "s", "--push"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("origin/main not found");
  });

  // origin/main exists but shares no history with HEAD: git merge-base exits 1
  // with no message, so pushBase can't classify it as "absent" and rethrows.
  test("--push rethrows when merge-base fails with an unclassifiable error", async () => {
    await writeFile(join(repo, "a.mjs"), `${FN_A}\n`);
    await commitAllIn(repo, "main history");
    await gitIn(repo, ["checkout", "-q", "--orphan", "other"]);
    await writeFile(join(repo, "b.mjs"), `${FN_B}\n`);
    await commitAllIn(repo, "unrelated history");
    await markCurrentAsOriginMain(repo);
    await gitIn(repo, ["checkout", "-q", "main"]);

    await expect(main(["node", "s", "--push"])).rejects.toThrow();
    expect(io.text(io.stdoutSpy)).not.toContain("origin/main not found");
  });

  test("--push prints the no-code-files line when the diff has no candidates", async () => {
    await writeFile(join(repo, "readme.md"), "# hi\n");
    await commitAllIn(repo, "baseline docs only");
    await markCurrentAsOriginMain(repo);
    await writeFile(join(repo, "notes.md"), "more\n");
    await commitAllIn(repo, "more docs");

    await main(["node", "s", "--push"]);
    expect(io.text(io.stdoutSpy)).toContain("no");
    expect(io.text(io.stdoutSpy)).toContain("code files");
  });

  test("--staged flags a staged duplicate body and exits 1", async () => {
    await seedTwoCloneFiles();
    // Stage both new files without committing so --cached sees them as added.
    await gitIn(repo, ["add", "-A"]);

    await expect(main(["node", "s", "--staged"])).rejects.toThrow(
      /__exit__:1/,
    );
    expect(io.text(io.stderrSpy)).toContain("newly-introduced duplicate");
  });

  test("--staged over a clean staged diff prints the OK line", async () => {
    await writeFile(join(repo, "solo.mjs"), `${FN_A}\n`);
    await gitIn(repo, ["add", "-A"]);
    await main(["node", "s", "--staged"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain(
      "no newly-introduced duplicate function bodies",
    );
  });

  test("--all lists every clone cluster report-only and exits 0", async () => {
    await seedTwoCloneFiles();
    await commitAllIn(repo, "two clones");

    await main(["node", "s", "--all"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    const out = io.text(io.stdoutSpy);
    expect(out).toContain("duplicate function body");
    expect(out).toContain("cluster(s)");
  });

  test("--all with CO_JSON emits one JSON violations line and never exits", async () => {
    await seedTwoCloneFiles();
    await commitAllIn(repo, "two clones");

    process.env.CO_JSON = "1";
    try {
      await main(["node", "s", "--all"]);
    } finally {
      delete process.env.CO_JSON;
    }
    expect(io.exitSpy).not.toHaveBeenCalled();
    const lines = io.text(io.stdoutSpy).split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).violations.length).toBeGreaterThan(0);
  });

  test("--files with a clone in a listed file writes to stderr and exits 1", async () => {
    await seedTwoCloneFiles();
    await commitAllIn(repo, "two clones");

    await expect(
      main(["node", "s", "--files", "userstore.mjs", "vendorstore.mjs"]),
    ).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toContain("userstore.mjs");
  });

  test("--files with no clone among the listed files prints the clean line", async () => {
    await writeFile(join(repo, "userstore.mjs"), `${FN_A}\n`);
    await commitAllIn(repo, "single helper");

    await main(["node", "s", "--files", "userstore.mjs"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("no violations in the given files");
  });

  test("--files with only non-candidate paths prints the no-code-files line", async () => {
    await writeFile(join(repo, "readme.md"), "# hi\n");
    await commitAllIn(repo, "docs");

    await main(["node", "s", "--files", "readme.md"]);
    expect(io.text(io.stdoutSpy)).toContain("no code files given");
  });

  // .test./.spec. files, __tests__/ dirs, and templates/ are excluded candidates:
  // test files repeat setup shapes and templates emit per-lane near-duplicates.
  test("--files excludes test/spec, __tests__ and templates paths as non-candidates", async () => {
    await writeFile(join(repo, "thing.test.mjs"), `${FN_A}\n`);
    await commitAllIn(repo, "excluded paths");

    await main([
      "node",
      "s",
      "--files",
      "thing.test.mjs",
      "src/__tests__/x.mjs",
      "src/templates/y.mjs",
    ]);
    expect(io.text(io.stdoutSpy)).toContain("no code files given");
  });

  test("no mode prints usage and exits 2", async () => {
    await expect(main(["node", "s"])).rejects.toThrow(/__exit__:2/);
    expect(io.text(io.stderrSpy)).toContain("Usage:");
  });
});
