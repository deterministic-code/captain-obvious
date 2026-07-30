import { rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  commitAllIn,
  makeTempGitRepo,
  markCurrentAsOriginMain,
  runHookPush,
} from "./test-helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LINT = resolve(HERE, "..", "lint-dup-structural", "check.mjs");

const REGEX_TABLE = `export const CONV = {
  typescript: { prunePattern: /^[A-Za-z]+\\.ts$/, ext: ".ts" },
  rust: { prunePattern: /^[A-Za-z_]+\\.rs$/, ext: ".rs" },
  python: { prunePattern: /^[A-Za-z_]+\\.py$/, ext: ".py" },
};
`;

async function seedFreshTable(repo) {
  await writeFile(
    join(repo, "unrelated.mjs"),
    `export const version = "1.0.0";\n`,
  );
  await commitAllIn(repo, "baseline: no convention table");
  await markCurrentAsOriginMain(repo);
  await writeFile(join(repo, "conventions.mjs"), REGEX_TABLE);
  await commitAllIn(
    repo,
    "add a 3-language convention table with a regex column",
  );
}

describe("lint-dup-structural / --push ratchet", () => {
  let repo;

  beforeEach(async () => {
    repo = await makeTempGitRepo("lint-dup-structural-");
  });

  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  test("a fresh regex convention table in the new commit is flagged as newly-introduced", async () => {
    await seedFreshTable(repo);

    const result = await runHookPush(LINT, repo);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("newly-introduced sibling-duplication");
    expect(result.stderr).toContain("conventions.mjs");
  });

  test("a table already in the baseline with an unrelated second-commit change exits 0", async () => {
    await writeFile(join(repo, "conventions.mjs"), REGEX_TABLE);
    await writeFile(join(repo, "notes.mjs"), `export const note = "a";\n`);
    await commitAllIn(repo, "baseline: convention table already present");
    await markCurrentAsOriginMain(repo);

    await writeFile(join(repo, "notes.mjs"), `export const note = "b";\n`);
    await commitAllIn(repo, "touch an unrelated line only");

    const result = await runHookPush(LINT, repo);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("no newly-introduced sibling duplication");
  });

  test("--warn on the newly-introduced scenario exits 0 but prints the advisory banner", async () => {
    await seedFreshTable(repo);

    const result = await runHookPush(LINT, repo, ["--push", "--warn"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("⚠");
    expect(result.stderr).toContain("newly-introduced sibling-duplication");
  });
});
