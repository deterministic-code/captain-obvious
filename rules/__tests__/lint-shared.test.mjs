import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  emitHookReport,
  emitJson,
  formatViolation,
  isExcluded,
  isInvokedAsScript,
  isLintable,
  jsonMode,
  lintFileWith,
  listAllFiles,
  listStagedFiles,
  readSourceOrNull,
  repoRootOf,
  resolveToolBin,
  runFileHook,
  selectHookFiles,
  stripStringsAndComments,
} from "../_kit/lint-shared.mjs";

const execFileAsync = promisify(execFile);

const VIOLATION = {
  path: "a.ts",
  line: 1,
  col: 1,
  kind: "isp",
  detail: "boom",
};

const opts = (collect) => ({
  usage: () => {},
  collect,
  okLine: "OK",
  summary: (n) => `SOLID-X: ${n} violation(s).`,
});

const spy = () => {
  const err = [];
  const exit = vi.spyOn(process, "exit").mockImplementation(() => {});
  const write = vi.spyOn(process.stderr, "write").mockImplementation((s) => {
    err.push(s);
    return true;
  });
  return { err, exit, write };
};

afterEach(() => vi.restoreAllMocks());

describe("runFileHook / --warn downgrades violations to advisory", () => {
  test("with --warn, a violation prints but does not exit non-zero", async () => {
    const { err, exit } = spy();
    await runFileHook(
      ["node", "hook", "--files", "a.ts", "--warn"],
      opts(() => [VIOLATION]),
    );
    expect(exit).not.toHaveBeenCalled();
    expect(err.join("")).toContain("advisory");
    expect(err.join("")).toContain("boom");
  });

  test("--warn is stripped before file selection (not treated as a path)", async () => {
    const seen = [];
    await runFileHook(
      ["node", "hook", "--files", "a.ts", "--warn"],
      opts((path) => {
        seen.push(path);
        return [];
      }),
    );
    expect(seen).toEqual(["a.ts"]);
  });

  test("without --warn, a violation exits 1 (still blocking)", async () => {
    const { exit } = spy();
    await runFileHook(
      ["node", "hook", "--files", "a.ts"],
      opts(() => [VIOLATION]),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  test("a clean run never exits, warn or not", async () => {
    const { exit } = spy();
    await runFileHook(
      ["node", "hook", "--files", "a.ts", "--warn"],
      opts(() => []),
    );
    await runFileHook(
      ["node", "hook", "--files", "a.ts"],
      opts(() => []),
    );
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("isExcluded / isLintable", () => {
  test("a path under an excluded dir is excluded (leading ./ tolerated)", () => {
    expect(isExcluded("node_modules/x/a.ts")).toBe(true);
    expect(isExcluded("./src/dist/a.ts")).toBe(true);
  });
  test("a plain source path is not excluded", () => {
    expect(isExcluded("src/a.ts")).toBe(false);
  });
  test("a custom parts list overrides the default excludes", () => {
    expect(isExcluded("weird/a.ts", ["/weird/"])).toBe(true);
    expect(isExcluded("weird/a.ts", ["/other/"])).toBe(false);
  });
  test("isLintable gates on both exclusion and supported extension", () => {
    expect(isLintable("src/a.ts")).toBe(true);
    expect(isLintable("src/a.py")).toBe(false);
    expect(isLintable("dist/a.ts")).toBe(false);
  });
  test("isLintable honours custom exts/parts options", () => {
    expect(isLintable("src/a.rs", { exts: new Set([".rs"]) })).toBe(true);
    expect(isLintable("keep/a.ts", { parts: ["/keep/"] })).toBe(false);
  });
});

describe("stripStringsAndComments", () => {
  test("blanks a line comment but keeps the newline column layout", () => {
    const out = stripStringsAndComments("a // secret\nb");
    expect(out).toBe("a          \nb");
  });
  test("blanks a block comment and closes on the terminating */", () => {
    const out = stripStringsAndComments("a /* x */ b");
    expect(out).toBe("a         b");
  });
  test("blanks quoted string bodies but preserves the quote delimiters", () => {
    expect(stripStringsAndComments("x = 'ab'")).toBe("x = '  '");
    expect(stripStringsAndComments('x = "ab"')).toBe('x = "  "');
    expect(stripStringsAndComments("x = `ab`")).toBe("x = `  `");
  });
  test("a multi-line block comment preserves interior newlines", () => {
    expect(stripStringsAndComments("/* a\nb */x")).toBe("    \n    x");
  });
  test("a multi-line template literal preserves interior newlines", () => {
    expect(stripStringsAndComments("`a\nb`")).toBe("` \n `");
  });
  test("a slash right after a punctuation operator opens a regex", () => {
    // `=` is in the punctuation set, so regexCanStartAfter returns true here
    expect(stripStringsAndComments("x = /ab/")).toBe("x = /  /");
  });
  test("keeps escaped chars from prematurely closing a string", () => {
    expect(stripStringsAndComments("'a\\'b'")).toBe("'    '");
  });
  test("keeps escaped chars inside a regex literal and preserves flags", () => {
    // leading `return` puts us in a regex-can-start position so the / opens a regex;
    // the escaped `\/` must not close the literal early — the `/g` flag survives.
    expect(stripStringsAndComments("return /a\\/b/g")).toBe("return /    /g");
  });
  test("a regex character class swallows a slash without closing the literal", () => {
    // the `/` inside `[...]` is class content, not the closing delimiter
    expect(stripStringsAndComments("return /[/]x/")).toBe("return /    /");
  });
  test("a bare slash at the start of input is treated as a regex opener", () => {
    // regexCanStartAfter returns true when nothing precedes the slash (j < 0)
    expect(stripStringsAndComments("/x/")).toBe("/ /");
  });
  test("division after an identifier is NOT treated as a regex", () => {
    // preceding token is `a` (not a keyword) so the slash stays a division op
    const out = stripStringsAndComments("a / b");
    expect(out).toBe("a / b");
  });
});

describe("formatViolation", () => {
  test("renders path:line:col, kind, and an indented detail line", () => {
    expect(
      formatViolation({ path: "a.ts", line: 3, col: 7, kind: "dup", detail: "x" }),
    ).toBe("a.ts:3:7  dup\n    x");
  });
});

describe("emitHookReport", () => {
  const spyOut = () => {
    const out = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      out.push(s);
      return true;
    });
    return out;
  };

  test("a clean --staged run notes the staged-diff scope in the ok line", () => {
    const out = spyOut();
    emitHookReport([], { mode: "--staged", okLine: "OK", summaryLine: "S" });
    expect(out.join("")).toBe("OK in staged diff.\n");
  });

  test("a clean non-staged run omits the staged-diff qualifier", () => {
    const out = spyOut();
    emitHookReport([], { mode: "--all", okLine: "OK", summaryLine: "S" });
    expect(out.join("")).toBe("OK.\n");
  });
});

describe("jsonMode / emitJson", () => {
  const saved = process.env.CO_JSON;
  afterEach(() => {
    if (saved === undefined) delete process.env.CO_JSON;
    else process.env.CO_JSON = saved;
    vi.restoreAllMocks();
  });

  test("jsonMode is true only when CO_JSON is exactly '1'", () => {
    delete process.env.CO_JSON;
    expect(jsonMode()).toBe(false);
    process.env.CO_JSON = "1";
    expect(jsonMode()).toBe(true);
    process.env.CO_JSON = "0";
    expect(jsonMode()).toBe(false);
  });

  test("emitJson writes one violations line to stdout", () => {
    const out = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      out.push(s);
      return true;
    });
    emitJson([VIOLATION]);
    expect(out.join("")).toBe(JSON.stringify({ violations: [VIOLATION] }) + "\n");
  });

  test("emitHookReport in JSON mode emits JSON and never exits", () => {
    process.env.CO_JSON = "1";
    const out = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      out.push(s);
      return true;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    emitHookReport([VIOLATION], { mode: "--all", okLine: "OK", summaryLine: "S" });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(JSON.parse(out.join(""))).toEqual({ violations: [VIOLATION] });
  });
});

describe("selectHookFiles", () => {
  afterEach(() => vi.restoreAllMocks());

  test("--files returns the trailing path args", async () => {
    expect(await selectHookFiles("--files", ["--files", "a.ts", "b.ts"], () => {})).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });

  test("--staged / --all delegate to the git listing helpers", async () => {
    const root = await mkdtemp(join(tmpdir(), "shared-sel-"));
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "t@t.t"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "t"], { cwd: root });
    await writeFile(join(root, "a.ts"), "a", "utf8");
    await execFileAsync("git", ["add", "a.ts"], { cwd: root });
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(await selectHookFiles("--staged", [], () => {})).toEqual(["a.ts"]);
      await execFileAsync("git", ["commit", "-qm", "i"], { cwd: root });
      expect(await selectHookFiles("--all", [], () => {})).toEqual(["a.ts"]);
    } finally {
      process.chdir(cwd);
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an unrecognized mode prints usage and exits 2", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {});
    let usageCalled = false;
    await selectHookFiles("--bogus", [], () => {
      usageCalled = true;
    });
    expect(usageCalled).toBe(true);
    expect(exit).toHaveBeenCalledWith(2);
  });
});

describe("readSourceOrNull / lintFileWith", () => {
  let root;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "shared-src-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("reads an existing file's contents", async () => {
    const p = join(root, "a.ts");
    await writeFile(p, "hello", "utf8");
    expect(await readSourceOrNull(p)).toBe("hello");
  });

  test("a missing file yields null (it left the diff mid-run)", async () => {
    expect(await readSourceOrNull(join(root, "gone.ts"))).toBeNull();
  });

  test("a directory path yields null (EISDIR)", async () => {
    expect(await readSourceOrNull(root)).toBeNull();
  });

  test("a non-ENOENT/EISDIR read error propagates", async () => {
    await expect(readSourceOrNull("bad\0path.ts")).rejects.toThrow(
      /must be a string/,
    );
  });

  test("lintFileWith tags each violation with the relative path", async () => {
    await writeFile(join(root, "a.ts"), "src", "utf8");
    const found = await lintFileWith("a.ts", root, (src) => [
      { line: 1, col: 1, kind: "k", detail: src },
    ]);
    expect(found).toEqual([{ line: 1, col: 1, kind: "k", detail: "src", path: "a.ts" }]);
  });

  test("lintFileWith on a vanished file returns no violations", async () => {
    const found = await lintFileWith("gone.ts", root, () => {
      throw new Error("scanner must not run on a missing file");
    });
    expect(found).toEqual([]);
  });

  test("lintFileWith without a cwd uses the path as-is", async () => {
    const p = join(root, "abs.ts");
    await writeFile(p, "z", "utf8");
    const found = await lintFileWith(p, undefined, () => [
      { line: 1, col: 1, kind: "k", detail: "d" },
    ]);
    expect(found[0].path).toBe(p);
  });
});

describe("git-backed helpers against a real repo", () => {
  let root;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "shared-git-"));
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "t@t.t"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "t"], { cwd: root });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/a.ts"), "a", "utf8");
    await writeFile(join(root, "src/b.ts"), "b", "utf8");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("repoRootOf resolves the worktree toplevel", async () => {
    const resolved = await repoRootOf(root);
    // macOS temp dirs symlink through /private, so compare on basename tails
    expect(resolved.endsWith(root.replace(/^\/private/, ""))).toBe(true);
  });

  test("listStagedFiles reports only staged (ACMR) paths", async () => {
    await execFileAsync("git", ["add", "src/a.ts"], { cwd: root });
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(await listStagedFiles()).toEqual(["src/a.ts"]);
    } finally {
      process.chdir(cwd);
    }
  });

  test("listAllFiles reports every tracked path", async () => {
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "init"], { cwd: root });
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(await listAllFiles()).toEqual(["src/a.ts", "src/b.ts"]);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("resolveToolBin", () => {
  // prettier's package.json is directly resolvable and its `bin` is a string.
  test("resolves via the direct package.json export with a string bin", async () => {
    const bin = await resolveToolBin("prettier");
    expect(bin).toMatch(/prettier/);
  });

  // knip blocks the `./package.json` export, forcing the walk-up fallback, and
  // its `bin` is an object keyed by binName.
  test("resolves via the walk-up fallback with an object bin", async () => {
    const bin = await resolveToolBin("knip");
    expect(bin).toMatch(/knip/);
  });

  test("an uninstalled package explains that npm install is needed", async () => {
    await expect(resolveToolBin("no-such-tool-xyz")).rejects.toThrow(
      /not installed/,
    );
  });

  // pathe also blocks the package.json export (walk-up path) but declares no bin.
  test("a package with no matching bin trips the invariant", async () => {
    await expect(resolveToolBin("pathe")).rejects.toThrow(/declares no bin/);
  });
});

describe("isInvokedAsScript", () => {
  test("true when argv[1] matches the module's own file url", () => {
    const url = pathToFileURL(fileURLToPath(import.meta.url)).href;
    const saved = process.argv[1];
    process.argv[1] = fileURLToPath(import.meta.url);
    try {
      expect(isInvokedAsScript(url)).toBe(true);
    } finally {
      process.argv[1] = saved;
    }
  });

  test("false when the entrypoint is a different file", () => {
    expect(isInvokedAsScript(import.meta.url)).toBe(false);
  });

  test("false (not a crash) when there is no argv entrypoint at all", () => {
    const saved = process.argv[1];
    process.argv[1] = undefined;
    try {
      expect(isInvokedAsScript(import.meta.url)).toBe(false);
    } finally {
      process.argv[1] = saved;
    }
  });
});
