import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findViolations,
  lintFile,
  main,
  tierOf,
} from "../lint-test-disabling-skipping.mjs";
import { cleanupTmp } from "./test-helpers.mjs";

describe("tierOf", () => {
  test.each([
    ["frontend/e2e/views.spec.ts", "e2e"],
    ["frontend/e2e/chat-skill-combine.spec.ts", "e2e"],
    ["backend/src/x.functional.test.ts", "functional"],
    ["scripts/__tests__/y.functional.test.mjs", "functional"],
    ["typescript/src/repositories/foo.integration.test.ts", "integration"],
    ["backend/src/x.test.ts", "unit"],
    ["scripts/__tests__/y.test.mjs", "unit"],
    ["backend/e2e/backend_app.docker.functional.test.ts", "functional"],
    ["frontend/e2e/__tests__/spec-lint.test.ts", "unit"],
    ["backend/e2e/some-helper.spec.ts", "spec-other"],
    ["frontend/e2e/lib/verify-pipeline-honest.ts", "e2e-helper"],
    ["frontend/e2e/lib/select-backend-tile.ts", "e2e-helper"],
    ["frontend/e2e/fixtures/backend.ts", "e2e-helper"],
    ["frontend/e2e/fixtures/parity-asserts.ts", "e2e-helper"],
    ["scripts/some-source.mjs", null],
    ["README.md", null],
  ])("tierOf(%s) === %s", (path, expected) => {
    expect(tierOf(path)).toBe(expected);
  });
});

describe("findViolations — e2e-helper tier (suppression rules only)", () => {
  test("test.skip in a helper is flagged", () => {
    const v = findViolations(
      `test.skip(envvar === "pr", "nightly only");\n`,
      "e2e-helper",
    );
    expect(v.map((x) => x.kind)).toContain("skip-only-fixme");
  });

  test("describe.skip in a helper is flagged", () => {
    const v = findViolations(
      `describe.skip("legacy", () => {});\n`,
      "e2e-helper",
    );
    expect(v.map((x) => x.kind)).toContain("skip-only-fixme");
  });

  test("test.skipIf in a helper is flagged", () => {
    const v = findViolations(
      `test.skipIf(envvar === "pr")("x", () => {});\n`,
      "e2e-helper",
    );
    expect(v.map((x) => x.kind)).toContain("skip-if");
  });

  test("page.request in a helper is NOT flagged (helpers may legitimately wrap diagnostics)", () => {
    const v = findViolations(
      `export async function snapshot(page) { return page.request.get('/api/projects'); }\n`,
      "e2e-helper",
    );
    expect(v.map((x) => x.kind)).not.toContain("page-request");
  });

  test("page.route in a helper is NOT flagged", () => {
    const v = findViolations(
      `await page.route('/api/x', route => route.fulfill());\n`,
      "e2e-helper",
    );
    expect(v.map((x) => x.kind)).not.toContain("page-route");
  });

  test("vi.mock in a helper is NOT flagged (only functional tier bans it)", () => {
    const v = findViolations(`vi.mock('node:fs');\n`, "e2e-helper");
    expect(v.map((x) => x.kind)).not.toContain("vi-mock");
  });
});

describe("findViolations — e2e rules", () => {
  const SRC = (body) => body;
  test("page.request.fetch is flagged", () => {
    const v = findViolations(
      SRC(`await page.request.fetch('/api/x');\n`),
      "e2e",
    );
    expect(v.map((x) => x.kind)).toContain("page-request");
  });

  test("page.request.post is flagged", () => {
    const v = findViolations(SRC(`page.request.post('/api/x');\n`), "e2e");
    expect(v.map((x) => x.kind)).toContain("page-request");
  });

  test("page.route mock is flagged", () => {
    const v = findViolations(
      SRC(`await page.route(/api/, route => route.fulfill());\n`),
      "e2e",
    );
    expect(v.map((x) => x.kind)).toContain("page-route");
  });

  test("page.evaluate is flagged", () => {
    const v = findViolations(
      SRC(`await page.evaluate(() => document.title);\n`),
      "e2e",
    );
    expect(v.map((x) => x.kind)).toContain("page-evaluate");
  });

  test("test.use({ storageState ... }) is flagged", () => {
    const v = findViolations(
      SRC(`test.use({ storageState: 'state.json' });\n`),
      "e2e",
    );
    expect(v.map((x) => x.kind)).toContain("test-use-storage-state");
  });

  test("test.fail is flagged", () => {
    const v = findViolations(SRC(`test.fail('still red');\n`), "e2e");
    expect(v.map((x) => x.kind)).toContain("test-fail");
  });

  test(".retries(N) is flagged", () => {
    const v = findViolations(
      SRC(`test.describe.configure({});  spec.retries(2);\n`),
      "e2e",
    );
    expect(v.map((x) => x.kind)).toContain("retries");
  });

  test("honest e2e — real clicks and assertions — no violations", () => {
    const v = findViolations(
      SRC(
        `await page.goto('/'); await page.click('button'); await expect(page.locator('[data-status]')).toHaveAttribute('data-status', 'succeeded');\n`,
      ),
      "e2e",
    );
    expect(v).toEqual([]);
  });

  test("page.request inside a string literal is NOT flagged", () => {
    const v = findViolations(
      SRC(`const label = "page.request.fetch is forbidden";\n`),
      "e2e",
    );
    expect(v.map((x) => x.kind)).not.toContain("page-request");
  });

  test("page.request inside a // comment is NOT flagged", () => {
    const v = findViolations(
      SRC(`// page.request.fetch is forbidden\nawait page.click('x');\n`),
      "e2e",
    );
    expect(v.map((x) => x.kind)).not.toContain("page-request");
  });
});

describe("findViolations — functional rules", () => {
  test("vi.mock is flagged", () => {
    const v = findViolations(`vi.mock('node:fs');\n`, "functional");
    expect(v.map((x) => x.kind)).toContain("vi-mock");
  });

  test("vi.doMock is flagged", () => {
    const v = findViolations(
      `vi.doMock('node:child_process', () => ({}));\n`,
      "functional",
    );
    expect(v.map((x) => x.kind)).toContain("vi-mock");
  });

  test("jest.mock is flagged", () => {
    const v = findViolations(`jest.mock('adm-zip');\n`, "functional");
    expect(v.map((x) => x.kind)).toContain("vi-mock");
  });

  test("setTimeout(fn, 100) is flagged", () => {
    const v = findViolations(
      `await new Promise(r => setTimeout(r, 100));\n`,
      "functional",
    );
    expect(v.map((x) => x.kind)).toContain("set-timeout-numeric");
  });

  test("setTimeout(fn, 1_000) underscore literal is flagged", () => {
    const v = findViolations(
      `await new Promise(r => setTimeout(r, 1_000));\n`,
      "functional",
    );
    expect(v.map((x) => x.kind)).toContain("set-timeout-numeric");
  });

  test("setTimeout(fn, ARBITRARY_TIMEOUT) identifier arg is NOT flagged", () => {
    const v = findViolations(
      `setTimeout(fn, ARBITRARY_TIMEOUT);\n`,
      "functional",
    );
    expect(v.map((x) => x.kind)).not.toContain("set-timeout-numeric");
  });

  test("':memory:' sqlite is flagged", () => {
    const v = findViolations(
      `const db = new Database(':memory:');\n`,
      "functional",
    );
    expect(v.map((x) => x.kind)).toContain("sqlite-in-memory");
  });

  test("asserting ':memory:' is ABSENT from emitted output is honest, not flagged", () => {
    const v = findViolations(
      `expect(appContent).not.toContain('":memory:"');\n`,
      "functional",
    );
    expect(v.map((x) => x.kind)).not.toContain("sqlite-in-memory");
  });

  test("quote chars inside a regex literal do not unbalance the stripper", () => {
    const v = findViolations(
      `const re = /from\\s+["']axios["']/;\nconst label = "test.skip(";\n`,
      "unit",
    );
    expect(v).toEqual([]);
  });

  test("a real .skip after a regex literal is still flagged", () => {
    const v = findViolations(
      `const re = /["']/;\ntest.skip('a', () => {});\n`,
      "unit",
    );
    expect(v.map((x) => x.kind)).toContain("skip-only-fixme");
  });

  test("\".not.toContain('error')\" negative log assert is flagged", () => {
    const v = findViolations(
      `expect(stdout).not.toContain('error');\n`,
      "functional",
    );
    expect(v.map((x) => x.kind)).toContain("negative-log-assert");
  });

  test('"not.toMatch(/failed/)" negative log assert is flagged', () => {
    const v = findViolations(
      `expect(out).not.toMatch('failed');\n`,
      "functional",
    );
    expect(v.map((x) => x.kind)).toContain("negative-log-assert");
  });

  test("honest functional — real binary spawn and positive assertion — no violations", () => {
    const v = findViolations(
      `const { stdout } = await execFileAsync('migrate-up', []); expect(JSON.parse(stdout).status).toBe('succeeded');\n`,
      "functional",
    );
    expect(v).toEqual([]);
  });
});

describe("findViolations — universal (every tier)", () => {
  test.each(["e2e", "functional", "integration", "unit"])(
    "test.skip( is flagged in tier=%s",
    (tier) => {
      const v = findViolations(`test.skip('legacy', () => {});\n`, tier);
      expect(v.map((x) => x.kind)).toContain("skip-only-fixme");
    },
  );

  test.each(["e2e", "functional", "integration", "unit"])(
    "test.only( is flagged in tier=%s",
    (tier) => {
      const v = findViolations(`test.only('focus', () => {});\n`, tier);
      expect(v.map((x) => x.kind)).toContain("skip-only-fixme");
    },
  );

  test.each(["e2e", "functional", "integration", "unit"])(
    "describe.skip( is flagged in tier=%s",
    (tier) => {
      const v = findViolations(`describe.skip('legacy', () => {});\n`, tier);
      expect(v.map((x) => x.kind)).toContain("skip-only-fixme");
    },
  );

  test.each(["e2e", "functional", "integration", "unit"])(
    "test.skipIf( is flagged in tier=%s",
    (tier) => {
      const v = findViolations(`test.skipIf(env)('x', () => {});\n`, tier);
      expect(v.map((x) => x.kind)).toContain("skip-if");
    },
  );

  test.each(["e2e", "functional", "integration", "unit"])(
    "xit( is flagged in tier=%s",
    (tier) => {
      const v = findViolations(`xit('legacy', () => {});\n`, tier);
      expect(v.map((x) => x.kind)).toContain("x-prefix");
    },
  );

  test("test.skip( inside a string literal is NOT flagged", () => {
    const v = findViolations(`const label = "test.skip(";\n`, "unit");
    expect(v.map((x) => x.kind)).not.toContain("skip-only-fixme");
  });
});

describe("findViolations — non-test path returns empty", () => {
  test("null tier returns []", () => {
    expect(findViolations(`test.skip('x', () => {});`, null)).toEqual([]);
  });
});

describe("findViolations — expect(actual, /re/) with no matcher (universal)", () => {
  test("flags expect(x, /re/); as a no-op", () => {
    const v = findViolations(
      `test("t", () => { expect(file.content, /hello/); });\n`,
      "unit",
    );
    expect(v.map((x) => x.kind)).toContain("expect-no-matcher");
  });

  test("flags expect(x, 'literal'); as a no-op", () => {
    const v = findViolations(
      `test("t", () => { expect(file.path, "User.ts"); });\n`,
      "unit",
    );
    expect(v.map((x) => x.kind)).toContain("expect-no-matcher");
  });

  test("flags expect(x, y); across multiple lines", () => {
    const v = findViolations(
      `test("t", () => {\n  expect(\n    file.content,\n    /hello/,\n  );\n});\n`,
      "unit",
    );
    expect(v.map((x) => x.kind)).toContain("expect-no-matcher");
  });

  test("does NOT flag expect(x).toMatch(/re/)", () => {
    const v = findViolations(
      `test("t", () => { expect(file.content).toMatch(/hello/); });\n`,
      "unit",
    );
    expect(v.map((x) => x.kind)).not.toContain("expect-no-matcher");
  });

  test("does NOT flag expect(x, message).toBe(y) (message is legitimate hint on chained matcher)", () => {
    const v = findViolations(
      `test("t", () => { expect(x, "message").toBe(1); });\n`,
      "unit",
    );
    expect(v.map((x) => x.kind)).not.toContain("expect-no-matcher");
  });

  test("does NOT flag expect(fn()).not.toThrow()", () => {
    const v = findViolations(
      `test("t", () => { expect(() => fn(1, 2)).not.toThrow(); });\n`,
      "unit",
    );
    expect(v.map((x) => x.kind)).not.toContain("expect-no-matcher");
  });

  test("does NOT flag expect(arr).toEqual([1, 2, 3])", () => {
    const v = findViolations(
      `test("t", () => { expect(files.map((f) => f.path).sort()).toEqual(["a.ts", "b.ts"]); });\n`,
      "unit",
    );
    expect(v.map((x) => x.kind)).not.toContain("expect-no-matcher");
  });

  test("applies across all tiers (universal)", () => {
    for (const tier of [
      "unit",
      "integration",
      "functional",
      "e2e",
      "e2e-helper",
      "spec-other",
    ]) {
      const v = findViolations(`expect(x, /y/);\n`, tier);
      expect(
        v.map((x) => x.kind),
        `tier=${tier}`,
      ).toContain("expect-no-matcher");
    }
  });

  // A top-level comma with array/object literals in the args exercises the
  // nested `[`/`{`/`]`/`}` depth bookkeeping in scanExpectArgs; the outer comma
  // is still a bare no-op expect.
  test("flags expect(x, [{ k: 1 }]); despite nested bracket/brace pairs", () => {
    const v = findViolations(
      `test("t", () => { expect(actual, [{ k: 1 }]); });\n`,
      "unit",
    );
    expect(v.map((x) => x.kind)).toContain("expect-no-matcher");
  });

  // A comma nested *inside* an object/array is NOT a top-level arg separator,
  // so expect({ a: 1, b: 2 }) with a single argument is not a no-op.
  test("does NOT flag expect({ a: 1, b: 2 }).toEqual(...) — comma is nested", () => {
    const v = findViolations(
      `test("t", () => { expect({ a: 1, b: 2 }).toEqual(x); });\n`,
      "unit",
    );
    expect(v.map((x) => x.kind)).not.toContain("expect-no-matcher");
  });

  // Whitespace between the closing paren and the chained matcher must be
  // skipped before the `.` check, so a matcher on the next line is honored.
  test("does NOT flag expect(x, msg)\\n  .toBe(y) — whitespace-then-dot is a chained matcher", () => {
    const v = findViolations(
      `test("t", () => { expect(x, "msg")\n  .toBe(1); });\n`,
      "unit",
    );
    expect(v.map((x) => x.kind)).not.toContain("expect-no-matcher");
  });
});

describe("lintFile", () => {
  let tmp;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "lint-honesty-"));
    await mkdir(join(tmp, "frontend/e2e"), { recursive: true });
  });
  afterEach(async () => {
    await cleanupTmp(tmp);
  });

  test("e2e file with page.request returns violations", async () => {
    const rel = "frontend/e2e/bad.spec.ts";
    await writeFile(
      join(tmp, rel),
      `import { test } from '@playwright/test';\ntest('bad', async ({ page }) => { await page.request.get('/api/x'); });\n`,
    );
    const v = await lintFile(rel, tmp);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].path).toBe(rel);
  });

  test("non-test file returns empty regardless of content", async () => {
    const rel = "frontend/e2e/helper.ts";
    await writeFile(join(tmp, rel), `export const x = "test.skip(";\n`);
    const v = await lintFile(rel, tmp);
    expect(v).toEqual([]);
  });

  test("missing file returns empty (does not throw)", async () => {
    const v = await lintFile("frontend/e2e/does-not-exist.spec.ts", tmp);
    expect(v).toEqual([]);
  });

  // With no cwd, the path is used as-is (no resolve) — pass an absolute path.
  test("absolute path with no cwd is read directly", async () => {
    const abs = join(tmp, "frontend/e2e/direct.spec.ts");
    await writeFile(abs, `test('bad', async ({ page }) => { await page.request.get('/'); });\n`);
    const v = await lintFile(abs);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].path).toBe(abs);
  });

  // A non-ENOENT read error (EISDIR when the path is a directory) is rethrown.
  test("rethrows a non-ENOENT read error (EISDIR on a directory)", async () => {
    const dir = join(tmp, "frontend/e2e/adir.spec.ts");
    await mkdir(dir);
    await expect(lintFile(dir)).rejects.toMatchObject({ code: "EISDIR" });
  });
});

describe("main --files mode", () => {
  let tmp, exit, errors, outs;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "lint-honesty-main-"));
    await mkdir(join(tmp, "scripts"));
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

  test("--files clean test exits 0", async () => {
    await writeFile(
      join(tmp, "frontend/e2e/ok.spec.ts"),
      `test('ok', async ({ page }) => { await page.click('button'); });\n`,
    );
    await expect(
      main(
        [
          "node",
          "lint-test-disabling-skipping.mjs",
          "--files",
          "frontend/e2e/ok.spec.ts",
        ],
        { cwd: tmp },
      ),
    ).resolves.toBeUndefined();
    expect(exit).toBe(null);
  });

  test("--files violating test exits 1 with violation in stderr", async () => {
    await writeFile(
      join(tmp, "frontend/e2e/bad.spec.ts"),
      `test('bad', async ({ page }) => { await page.request.get('/'); });\n`,
    );
    await expect(
      main(
        [
          "node",
          "lint-test-disabling-skipping.mjs",
          "--files",
          "frontend/e2e/bad.spec.ts",
        ],
        { cwd: tmp },
      ),
    ).rejects.toThrow("__EXIT__");
    expect(exit).toBe(1);
    expect(errors.join("")).toMatch(/page-request/);
  });

  test("--files with CO_JSON emits one JSON violations line and never exits", async () => {
    await writeFile(
      join(tmp, "frontend/e2e/bad.spec.ts"),
      `test('bad', async ({ page }) => { await page.request.get('/'); });\n`,
    );
    process.env.CO_JSON = "1";
    try {
      await main(
        [
          "node",
          "lint-test-disabling-skipping.mjs",
          "--files",
          "frontend/e2e/bad.spec.ts",
        ],
        { cwd: tmp },
      );
    } finally {
      delete process.env.CO_JSON;
    }
    expect(exit).toBe(null);
    const lines = outs.join("").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).violations.length).toBeGreaterThan(0);
  });
});
