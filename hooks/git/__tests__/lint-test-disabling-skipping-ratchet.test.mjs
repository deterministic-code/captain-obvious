import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  countMarkers,
  diffMarkers,
  FORBIDDEN_MARKERS,
  main,
} from "../lint-test-disabling-skipping.mjs";
import { cleanupTmp } from "./test-helpers.mjs";

const execFileAsync = promisify(execFile);

async function gitInit(cwd) {
  await execFileAsync("git", ["init", "--quiet", "-b", "main"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@test"], { cwd });
  await execFileAsync("git", ["config", "user.name", "test"], { cwd });
  await execFileAsync("git", ["config", "commit.gpgsign", "false"], { cwd });
}

async function stage(tmp, rel, content) {
  await writeFile(join(tmp, rel), content);
  await execFileAsync("git", ["add", rel], { cwd: tmp });
}

async function commitModifyStage(tmp, rel, before, after) {
  await stage(tmp, rel, before);
  await execFileAsync("git", ["commit", "-m", "init", "--quiet"], { cwd: tmp });
  await stage(tmp, rel, after);
}

function runStaged(tmp) {
  return main(["node", "lint-test-disabling-skipping.mjs", "--staged"], {
    cwd: tmp,
  });
}

describe("countMarkers", () => {
  test("empty src has zero of every marker", () => {
    const c = countMarkers("");
    for (const m of FORBIDDEN_MARKERS) {
      expect(c[m.id]).toBe(0);
    }
  });

  test("counts test.skip occurrences", () => {
    const src = `test.skip('a', () => {});\ntest.skip('b', () => {});\n`;
    expect(countMarkers(src)["skip-marker"]).toBe(2);
  });

  test("counts vi.mock occurrences", () => {
    const src = `vi.mock('a'); vi.mock('b'); vi.doMock('c');\n`;
    expect(countMarkers(src).mock).toBe(3);
  });

  test("counts setTimeout numeric occurrences", () => {
    const src = `setTimeout(r, 100); setTimeout(r, 250); setTimeout(r, IDENT);\n`;
    expect(countMarkers(src)["set-timeout-numeric"]).toBe(2);
  });

  test("ignores markers inside strings", () => {
    const src = `const label = "test.skip(";\n`;
    expect(countMarkers(src)["skip-marker"]).toBe(0);
  });

  test("ignores markers inside line comments", () => {
    const src = `// test.skip(\nawait foo();\n`;
    expect(countMarkers(src)["skip-marker"]).toBe(0);
  });
});

describe("diffMarkers", () => {
  test("no change returns no regressions", () => {
    const src = `test('ok', () => { expect(1).toBe(1); });\n`;
    expect(diffMarkers(src, src)).toEqual([]);
  });

  test("adding test.skip is a regression", () => {
    const before = `test('a', () => {});\n`;
    const after = `test('a', () => {});\ntest.skip('b', () => {});\n`;
    const r = diffMarkers(before, after);
    expect(r.length).toBe(1);
    expect(r[0].id).toBe("skip-marker");
    expect(r[0].delta).toBe(1);
  });

  test("converting a real test to .skip is a regression", () => {
    const before = `test('a', () => { expect(1).toBe(1); });\n`;
    const after = `test.skip('a', () => { expect(1).toBe(1); });\n`;
    const r = diffMarkers(before, after);
    expect(r.map((x) => x.id)).toContain("skip-marker");
  });

  test("adding vi.mock is a regression", () => {
    const before = `test('a', () => {});\n`;
    const after = `vi.mock('node:fs');\ntest('a', () => {});\n`;
    const r = diffMarkers(before, after);
    expect(r.map((x) => x.id)).toContain("mock");
  });

  test("adding page.request is a regression", () => {
    const before = `test('a', async ({ page }) => { await page.click('x'); });\n`;
    const after = `test('a', async ({ page }) => { await page.request.get('/api'); });\n`;
    const r = diffMarkers(before, after);
    expect(r.map((x) => x.id)).toContain("page-request");
  });

  test("adding setTimeout(_, N) is a regression", () => {
    const before = `await waitFor(() => isReady());\n`;
    const after = `await new Promise(r => setTimeout(r, 500));\n`;
    const r = diffMarkers(before, after);
    expect(r.map((x) => x.id)).toContain("set-timeout-numeric");
  });

  test("REMOVING markers is NOT a regression", () => {
    const before = `test.skip('a', () => {}); vi.mock('x');\n`;
    const after = `test('a', () => {});\n`;
    expect(diffMarkers(before, after)).toEqual([]);
  });

  test("legitimate test rewrite (no markers either side) is fine", () => {
    const before = `test('a', () => { expect(1).toBe(1); });\n`;
    const after = `test('a', async () => { const x = await load(); expect(x).toBe(1); });\n`;
    expect(diffMarkers(before, after)).toEqual([]);
  });
});

describe("main --staged via git", () => {
  let tmp, exit, errors, outs;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "lint-edit-guard-"));
    await gitInit(tmp);
    await mkdir(join(tmp, "frontend/e2e"), { recursive: true });
    errors = [];
    outs = [];
    exit = null;
    process.exit = (c) => {
      exit = c;
      throw new Error("__EXIT__");
    };
    process.stderr.write = (s) => {
      errors.push(String(s));
      return true;
    };
    process.stdout.write = (s) => {
      outs.push(String(s));
      return true;
    };
  });
  afterEach(async () => {
    await cleanupTmp(tmp);
  });

  test("brand-new test file skips the ratchet but is caught by the absolute layer", async () => {
    await stage(tmp, "frontend/e2e/new.spec.ts", `test.skip('a', () => {});\n`);
    await expect(runStaged(tmp)).rejects.toThrow("__EXIT__");
    expect(exit).toBe(1);
    expect(errors.join("")).toMatch(/skip/);
    expect(errors.join("")).not.toMatch(/regressed honesty markers/);
  });

  test("modifying an existing test file to ADD .skip is rejected", async () => {
    await commitModifyStage(
      tmp,
      "frontend/e2e/x.spec.ts",
      `test('a', async ({ page }) => { await page.click('btn'); });\n`,
      `test.skip('a', async ({ page }) => { await page.click('btn'); });\n`,
    );
    await expect(runStaged(tmp)).rejects.toThrow("__EXIT__");
    expect(exit).toBe(1);
    expect(errors.join("")).toMatch(/skip-marker|skip/);
  });

  test("modifying an existing test file to ADD vi.mock is rejected", async () => {
    await mkdir(join(tmp, "backend"), { recursive: true });
    await commitModifyStage(
      tmp,
      "backend/x.functional.test.ts",
      `test('a', async () => { const x = await foo(); expect(x).toBe(1); });\n`,
      `vi.mock('foo');\ntest('a', async () => { const x = await foo(); expect(x).toBe(1); });\n`,
    );
    await expect(runStaged(tmp)).rejects.toThrow("__EXIT__");
    expect(exit).toBe(1);
    expect(errors.join("")).toMatch(/mock/);
  });

  test("modifying an existing test file with NO regression passes", async () => {
    await commitModifyStage(
      tmp,
      "frontend/e2e/x.spec.ts",
      `test('a', async ({ page }) => { await page.click('btn'); });\n`,
      `test('a', async ({ page }) => { await page.click('btn'); await page.fill('input', 'x'); });\n`,
    );
    await expect(runStaged(tmp)).resolves.toBeUndefined();
    expect(exit).toBe(null);
  });

  test("REMOVING a .skip from an existing test file passes (cleanup is welcome)", async () => {
    await commitModifyStage(
      tmp,
      "frontend/e2e/x.spec.ts",
      `test.skip('a', async ({ page }) => { await page.click('btn'); });\n`,
      `test('a', async ({ page }) => { await page.click('btn'); });\n`,
    );
    await expect(runStaged(tmp)).resolves.toBeUndefined();
    expect(exit).toBe(null);
  });
});
