import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Drive both `git rev-parse` (repoRootOf) and the knip subprocess
// deterministically. `promisify(execFile)` calls the mock as
// execFile(cmd, args, opts, cb); the knip run uses cmd === process.execPath.
let repoRootStdout = `${process.cwd()}\n`;
let knipResponder = null;
vi.mock("node:child_process", () => ({
  execFile: (cmd, args, opts, cb) => {
    const done = typeof opts === "function" ? opts : cb;
    if (cmd === "git" && args[0] === "rev-parse") {
      done(null, { stdout: repoRootStdout, stderr: "" });
      return;
    }
    if (!knipResponder) {
      done(new Error(`no knip responder for ${cmd} ${args.join(" ")}`));
      return;
    }
    const { err, stdout = "", stderr = "" } = knipResponder(args);
    if (err) {
      done(Object.assign(err, { stdout, stderr }));
      return;
    }
    done(null, { stdout, stderr });
  },
}));

const { knipIssuesToViolations, main } = await import("../lint-dead-code.mjs");

function knipJson(report) {
  knipResponder = () => ({ stdout: JSON.stringify(report) });
}

describe("lint-dead-code / knipIssuesToViolations", () => {
  test("a nonempty files entry yields one unused-file violation at line 1", () => {
    const issues = [
      {
        file: "scripts/foo.mjs",
        files: [{ name: "scripts/foo.mjs" }],
      },
    ];
    expect(knipIssuesToViolations(issues)).toEqual([
      {
        path: "scripts/foo.mjs",
        line: 1,
        col: 1,
        kind: "unused file",
        detail:
          "no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.",
      },
    ]);
  });

  test("a files entry without a `name` falls back to the issue's file path", () => {
    const issues = [{ file: "scripts/orphan.mjs", files: [{}] }];
    expect(knipIssuesToViolations(issues)[0].path).toBe("scripts/orphan.mjs");
  });

  test("exports and types entries yield per-entry violations with kind, path, line, col", () => {
    const issues = [
      {
        file: "scripts/bar.mjs",
        exports: [{ name: "parseX", line: 86, col: 17, pos: 2607 }],
        types: [{ name: "EdgeKind", line: 58, col: 13, pos: 900 }],
      },
    ];
    const detail =
      "nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.";
    expect(knipIssuesToViolations(issues)).toEqual([
      {
        path: "scripts/bar.mjs",
        line: 86,
        col: 17,
        kind: "unused export `parseX`",
        detail,
      },
      {
        path: "scripts/bar.mjs",
        line: 58,
        col: 13,
        kind: "unused type `EdgeKind`",
        detail,
      },
    ]);
  });

  test("an export missing line/col defaults both to 1", () => {
    const issues = [
      { file: "scripts/bar.mjs", exports: [{ name: "noPos" }] },
    ];
    expect(knipIssuesToViolations(issues)[0]).toMatchObject({
      path: "scripts/bar.mjs",
      line: 1,
      col: 1,
      kind: "unused export `noPos`",
    });
  });

  test("enumMembers object-of-arrays flattens into per-member violations", () => {
    const issues = [
      {
        file: "scripts/baz.mjs",
        enumMembers: {
          SomeEnum: [
            { name: "A", line: 5, col: 3 },
            { name: "B", line: 6, col: 3 },
          ],
          Other: [{ name: "C", line: 20, col: 7 }],
        },
      },
    ];
    expect(knipIssuesToViolations(issues).map((v) => v.kind)).toEqual([
      "unused enum member `A`",
      "unused enum member `B`",
      "unused enum member `C`",
    ]);
    expect(knipIssuesToViolations(issues)[0]).toMatchObject({
      path: "scripts/baz.mjs",
      line: 5,
      col: 3,
    });
  });

  test("an empty issues array yields no violations", () => {
    expect(knipIssuesToViolations([])).toEqual([]);
  });

  test("an issue with all groups empty or absent yields no violations", () => {
    const issues = [
      { file: "scripts/qux.mjs", files: [], exports: [], types: [] },
      { file: "scripts/quux.mjs" },
    ];
    expect(knipIssuesToViolations(issues)).toEqual([]);
  });
});

describe("lint-dead-code / main", () => {
  let exitSpy;
  let stderrSpy;
  let stdoutSpy;
  let savedExitCode;
  beforeEach(() => {
    repoRootStdout = `${process.cwd()}\n`;
    knipResponder = null;
    savedExitCode = process.exitCode;
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`__exit__:${code}`);
    });
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });
  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    process.exitCode = savedExitCode;
  });

  const stderrText = () => stderrSpy.mock.calls.map((c) => c[0]).join("");
  const stdoutText = () => stdoutSpy.mock.calls.map((c) => c[0]).join("");

  test("--all with no dead code prints the clean line and leaves exitCode unset", async () => {
    knipJson({ issues: [] });
    await main(["node", "s.mjs", "--all"]);
    expect(stdoutText()).toMatch(/no dead code found in the repo/);
    expect(process.exitCode).toBe(savedExitCode);
  });

  test("--all with dead code prints findings (blocking, no suffix) and sets exitCode 1", async () => {
    knipJson({
      issues: [{ file: "src/a.ts", exports: [{ name: "unusedFn", line: 3, col: 2 }] }],
    });
    await main(["node", "s.mjs", "--all"]);
    const out = stdoutText();
    expect(out).toMatch(/unused export `unusedFn`/);
    expect(out).toMatch(/1 dead-code finding\(s\) in the repo\. Whitelist/);
    expect(out).not.toMatch(/report-only/);
    expect(process.exitCode).toBe(1);
  });

  test("--all with CO_JSON emits JSON and leaves exitCode unset", async () => {
    knipJson({
      issues: [{ file: "src/a.ts", exports: [{ name: "unusedFn", line: 3, col: 2 }] }],
    });
    process.env.CO_JSON = "1";
    try {
      await main(["node", "s.mjs", "--all"]);
    } finally {
      delete process.env.CO_JSON;
    }
    const lines = stdoutText().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).violations[0].kind).toMatch(/unused export/);
    expect(process.exitCode).toBe(savedExitCode);
  });

  test("runKnip throws the invariant when `issues` is not an array", async () => {
    knipJson({ issues: 123 });
    await expect(main(["node", "s.mjs", "--all"])).rejects.toThrow(
      /invariant: knip report has no `issues` array/,
    );
  });

  test("--files with a matching violation prints report-only findings", async () => {
    const abs = `${process.cwd()}/src/b.ts`;
    knipJson({
      issues: [{ file: "src/b.ts", exports: [{ name: "deadExport", line: 9, col: 1 }] }],
    });
    await main(["node", "s.mjs", "--files", abs]);
    const out = stdoutText();
    expect(out).toMatch(/unused export `deadExport`/);
    expect(out).toMatch(/dead-code finding\(s\) in the given files \(report-only\)/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("--files with no paths prints the no-files line", async () => {
    await main(["node", "s.mjs", "--files"]);
    expect(stdoutText()).toMatch(/no files given/);
  });

  test("--files whose targets match no violations prints the clean given-files line", async () => {
    const abs = `${process.cwd()}/src/c.ts`;
    knipJson({
      issues: [{ file: "src/other.ts", exports: [{ name: "x", line: 1, col: 1 }] }],
    });
    await main(["node", "s.mjs", "--files", abs]);
    expect(stdoutText()).toMatch(/no dead code found in the given files/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("--files with CO_JSON emits one JSON line of matching violations", async () => {
    const abs = `${process.cwd()}/src/b.ts`;
    knipJson({
      issues: [{ file: "src/b.ts", exports: [{ name: "deadExport", line: 9, col: 1 }] }],
    });
    process.env.CO_JSON = "1";
    try {
      await main(["node", "s.mjs", "--files", abs]);
    } finally {
      delete process.env.CO_JSON;
    }
    const lines = stdoutText().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).violations.length).toBeGreaterThan(0);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("--files with CO_JSON and no paths emits an empty JSON line", async () => {
    process.env.CO_JSON = "1";
    try {
      await main(["node", "s.mjs", "--files"]);
    } finally {
      delete process.env.CO_JSON;
    }
    expect(JSON.parse(stdoutText().trim())).toEqual({ violations: [] });
  });

  test("an unknown/absent mode prints usage and exits 2", async () => {
    await expect(main(["node", "s.mjs"])).rejects.toThrow(/__exit__:2/);
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(stderrText()).toMatch(/Usage:/);
  });
});
