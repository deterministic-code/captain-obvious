import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLASS_LIMITS,
  analyzeSource,
  classesInDiff,
  isAnalyzable,
  runSolidSHook,
} from "../_kit/solid-s-metrics.mjs";
import { main } from "../lint-solid-s/check.mjs";
import {
  cleanupTmp,
  commitAllIn,
  gitIn,
  makeTempGitRepo,
  mockProcessIo,
} from "./test-helpers.mjs";

const only = (src) => {
  const classes = analyzeSource("f.ts", src);
  expect(classes).toHaveLength(1);
  return classes[0];
};

describe("solid-s-metrics / LCOM4 cohesion", () => {
  test("a class whose methods all share one field is cohesive (LCOM4 1)", () => {
    const src = [
      "class Counter {",
      "  private n = 0;",
      "  inc() { this.n++; }",
      "  dec() { this.n--; }",
      "  value() { return this.n; }",
      "}",
    ].join("\n");
    expect(only(src).lcom4).toBe(1);
  });

  test("methods split into two field-groups score LCOM4 2", () => {
    const src = [
      "class Split {",
      "  private a = 0; private b = 0;",
      "  incA() { this.a++; }",
      "  readA() { return this.a; }",
      "  incB() { this.b++; }",
      "  readB() { return this.b; }",
      "}",
    ].join("\n");
    expect(only(src).lcom4).toBe(2);
  });

  test("a sibling call bridges two field-groups back into one component", () => {
    const src = [
      "class Bridged {",
      "  private a = 0; private b = 0;",
      "  incA() { this.a++; this.incB(); }",
      "  incB() { this.b++; }",
      "}",
    ].join("\n");
    expect(only(src).lcom4).toBe(1);
  });

  test("stateless no-op / throw-stub methods do not inflate LCOM4", () => {
    const src = [
      "class Repo {",
      "  private table = [];",
      "  open() {}",
      "  query() { throw new Error('unsupported'); }",
      "  find(id) { return this.table[id]; }",
      "  all() { return this.table; }",
      "}",
    ].join("\n");
    expect(only(src).lcom4).toBe(1);
  });

  test("the constructor is excluded so field initialization does not force cohesion", () => {
    const src = [
      "class TwoJobs {",
      "  private a; private b;",
      "  constructor() { this.a = 1; this.b = 2; }",
      "  useA() { return this.a; }",
      "  alsoA() { return this.a + 1; }",
      "  useB() { return this.b; }",
      "  alsoB() { return this.b + 1; }",
      "}",
    ].join("\n");
    expect(only(src).lcom4).toBe(2);
  });
});

describe("solid-s-metrics / stateless-but-separable concerns", () => {
  test("methods sharing no field but each using a distinct import are separate components", () => {
    const src = [
      'import { parseCsv } from "./csv";',
      'import { sendEmail } from "./email";',
      'import { renderPdf } from "./pdf";',
      "class Utils {",
      "  importUsers(t) { return parseCsv(t); }",
      "  notify(to) { return sendEmail(to); }",
      "  invoice(d) { return renderPdf(d); }",
      "}",
    ].join("\n");
    expect(only(src).lcom4).toBe(3);
  });

  test("methods sharing the same import collapse into one component", () => {
    const src = [
      'import { log } from "./log";',
      "class Traced {",
      "  a() { return log('a'); }",
      "  b() { return log('b'); }",
      "}",
    ].join("\n");
    expect(only(src).lcom4).toBe(1);
  });

  test("a pure no-op with no import is still excluded (no false positive)", () => {
    const src = [
      'import { load } from "./load";',
      "class Repo {",
      "  private cache = {};",
      "  open() {}",
      "  warm(k) { this.cache[k] = load(k); }",
      "  get(k) { return this.cache[k]; }",
      "}",
    ].join("\n");
    expect(only(src).lcom4).toBe(1);
  });
});

describe("solid-s-metrics / external dependency analysis", () => {
  const dumpingGround = [
    'import { Db } from "./db";',
    'import { Sql } from "./sql";',
    'import { HttpClient } from "./http";',
    "class UserManager {",
    "  private db: Db; private sql: Sql; private http: HttpClient;",
    "  load(id) { return this.db.query(this.sql.byId(id)); }",
    "  save(u) { return this.db.write(this.sql.insert(u)); }",
    "  fetch(url) { return this.http.get(url); }",
    "}",
  ].join("\n");

  test("injected collaborators are attributed to the cluster that uses them", () => {
    const cls = only(dumpingGround);
    expect(cls.lcom4).toBe(2);
    expect(cls.disjoint.split).toBe(true);
    expect(cls.disjoint.left).toEqual(["Db", "Sql"]);
    expect(cls.disjoint.right).toEqual(["HttpClient"]);
  });

  test("fan-out counts distinct imported collaborators even when LCOM4 is 1", () => {
    const deps = Array.from({ length: 9 }, (_, i) =>
      String.fromCharCode(65 + i),
    );
    const src = [
      ...deps.map((d) => `import { ${d} } from "./${d}";`),
      "class Orchestrator {",
      `  constructor(${deps.map((d) => `private ${d.toLowerCase()}: ${d}`).join(", ")}) {}`,
      `  run() { ${deps.map((d) => `this.${d.toLowerCase()};`).join(" ")} }`,
      `  stop() { this.a; this.b; }`,
      "}",
    ].join("\n");
    const cls = only(src);
    expect(cls.lcom4).toBe(1);
    expect(cls.deps).toBe(9);
    expect(cls.deps).toBeGreaterThan(CLASS_LIMITS.deps);
  });
});

describe("solid-s-metrics / analysis edge branches", () => {
  test("a qualified-name field type resolves to its head import", () => {
    const src = [
      'import * as ns from "./ns";',
      "class Holder {",
      "  private a: ns.Thing; private b: ns.Thing;",
      "  useA() { return this.a; }",
      "  useB() { return this.b; }",
      "}",
    ].join("\n");
    const cls = only(src);
    expect(cls.deps).toBe(1);
    expect([...new Set([cls.disjoint.split])]).toContain(false);
  });

  test("a field typed by a non-imported reference contributes no dep", () => {
    const src = [
      "class Holder {",
      "  private a: Local; private b: number;",
      "  useA() { return this.a; }",
      "  useB() { return this.a + 1; }",
      "}",
    ].join("\n");
    expect(only(src).deps).toBe(0);
  });

  test("a plain (non-parameter-property) constructor param is not a field", () => {
    const src = [
      "class C {",
      "  private a = 0;",
      "  constructor(seed) { this.a = seed; }",
      "  useA() { return this.a; }",
      "  alsoA() { return this.a + 1; }",
      "}",
    ].join("\n");
    expect(only(src).lcom4).toBe(1);
  });

  test("two clusters where only one carries a dep are not a clean split (fewer than 2 non-empty)", () => {
    const src = [
      'import { log } from "./log";',
      "class OneDep {",
      "  private a = 0; private b = 0;",
      "  incA() { this.a++; log(this.a); }",
      "  readA() { return this.a; }",
      "  incB() { this.b++; }",
      "  readB() { return this.b; }",
      "}",
    ].join("\n");
    const cls = only(src);
    expect(cls.lcom4).toBe(2);
    expect(cls.disjoint.split).toBe(false);
  });
});

describe("solid-s-metrics / escape hatches", () => {
  test("a class below the method floor is never flagged", () => {
    const src = [
      "class Dto {",
      "  private a = 0; private b = 0;",
      "  onlyOne() { return this.a + this.b; }",
      "}",
    ].join("\n");
    expect(only(src).methodCount).toBeLessThan(2);
    expect(only(src).lcom4).toBe(1);
  });

  test("a solid-s-allow marker opts a class out", () => {
    const src = [
      "// solid-s-allow: facade over independent subsystems",
      "class Facade {",
      "  private a = 0; private b = 0;",
      "  incA() { this.a++; }",
      "  incB() { this.b++; }",
      "}",
    ].join("\n");
    expect(only(src).allow).toBe(true);
  });
});

// A class that splits into two field-clusters (LCOM4 2) — the canonical cohesion offender.
const SPLIT_CLASS = [
  "class Split {",
  "  private a = 0; private b = 0;",
  "  incA() { this.a++; }",
  "  readA() { return this.a; }",
  "  incB() { this.b++; }",
  "  readB() { return this.b; }",
  "}",
].join("\n");

describe("solid-s-metrics / isAnalyzable & anonymous class", () => {
  test("test files, excluded paths, and non-JS extensions are skipped", () => {
    expect(isAnalyzable("src/x.test.ts")).toBe(false);
    expect(isAnalyzable("node_modules/x.ts")).toBe(false);
    expect(isAnalyzable("src/x.md")).toBe(false);
    expect(isAnalyzable("src/x.ts")).toBe(true);
  });

  test("an anonymous class expression is named (anonymous class)", () => {
    const src = "const C = class { a() { this.x; } b() { this.x; } };";
    const [cls] = analyzeSource("f.ts", src);
    expect(cls.name).toBe("(anonymous class)");
  });
});

describe("solid-s-metrics / classesInDiff", () => {
  const classes = [{ startLine: 3, endLine: 6 }];

  test("keeps a class when an added line falls inside its span", () => {
    expect(classesInDiff(classes, new Set([5]))).toHaveLength(1);
  });
  test("drops a class untouched by the diff", () => {
    expect(classesInDiff(classes, new Set([10]))).toHaveLength(0);
  });
});

describe("solid-s-metrics / runSolidSHook runner", () => {
  let tmpRoot;
  let io;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "solid-s-run-"));
    io = mockProcessIo();
  });
  afterEach(async () => {
    io.restore();
    await cleanupTmp(tmpRoot);
  });

  test("empty argv prints usage and exits 2", async () => {
    await expect(runSolidSHook(["node", "s.mjs"])).rejects.toThrow(
      /__exit__:2/,
    );
    expect(io.text(io.stderrSpy)).toMatch(/Usage/);
  });

  test("--files clean class prints the ok line without exiting", async () => {
    const clean = join(tmpRoot, "clean.ts");
    await writeFile(clean, "class Ok { a() { this.x; } }\n", "utf8");
    await runSolidSHook(["node", "s.mjs", "--files", clean]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("SOLID-S: no SRP violations");
  });

  test("--files with a clean-split cohesion offender emits the {clusters} suffix", async () => {
    const bad = join(tmpRoot, "dump.ts");
    const dump = [
      'import { Db } from "./db";',
      'import { Http } from "./http";',
      "class UserManager {",
      "  private db: Db; private http: Http;",
      "  load(id) { return this.db.query(id); }",
      "  save(u) { return this.db.write(u); }",
      "  fetch(url) { return this.http.get(url); }",
      "}",
    ].join("\n");
    await writeFile(bad, dump, "utf8");
    await expect(
      runSolidSHook(["node", "s.mjs", "--files", bad]),
    ).rejects.toThrow(/__exit__:1/);
    const err = io.text(io.stderrSpy);
    expect(err).toContain("cohesion");
    expect(err).toMatch(/one cluster owns \{Db\}/);
  });

  test("--files with a non-split cohesion offender emits the generic suffix", async () => {
    const bad = join(tmpRoot, "shared.ts");
    const shared = [
      'import { log } from "./log";',
      "class OneDep {",
      "  private a = 0; private b = 0;",
      "  incA() { this.a++; log(this.a); }",
      "  readA() { return this.a; }",
      "  incB() { this.b++; }",
      "  readB() { return this.b; }",
      "}",
    ].join("\n");
    await writeFile(bad, shared, "utf8");
    await expect(
      runSolidSHook(["node", "s.mjs", "--files", bad]),
    ).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toContain(
      "independent groups sharing no state",
    );
  });

  test("--files with a high fan-out class emits a fan-out violation", async () => {
    const deps = Array.from({ length: 9 }, (_, i) =>
      String.fromCharCode(65 + i),
    );
    const src = [
      ...deps.map((d) => `import { ${d} } from "./${d}";`),
      "class Orchestrator {",
      `  constructor(${deps.map((d) => `private ${d.toLowerCase()}: ${d}`).join(", ")}) {}`,
      `  run() { ${deps.map((d) => `this.${d.toLowerCase()};`).join(" ")} }`,
      "  stop() { this.a; this.b; }",
      "}",
    ].join("\n");
    const bad = join(tmpRoot, "fanout.ts");
    await writeFile(bad, src, "utf8");
    await expect(
      runSolidSHook(["node", "s.mjs", "--files", bad]),
    ).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toContain("fan-out");
  });

  test("--files rethrows a non-ENOENT read error (a directory named like a .ts file)", async () => {
    const dirPath = join(tmpRoot, "dir.ts");
    await mkdir(dirPath);
    await expect(
      runSolidSHook(["node", "s.mjs", "--files", dirPath]),
    ).rejects.toThrow(/EISDIR|illegal operation on a directory/);
  });

  test("--files skips a non-analyzable path (.md) and stays clean", async () => {
    const md = join(tmpRoot, "notes.md");
    await writeFile(md, SPLIT_CLASS, "utf8");
    await runSolidSHook(["node", "s.mjs", "--files", md]);
    expect(io.exitSpy).not.toHaveBeenCalled();
  });

  test("--warn on an offender reports advisory and does not exit", async () => {
    const bad = join(tmpRoot, "warn.ts");
    await writeFile(bad, SPLIT_CLASS, "utf8");
    await runSolidSHook(["node", "s.mjs", "--files", bad, "--warn"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stderrSpy)).toMatch(/advisory/);
  });

  test("--files on a missing file swallows ENOENT and stays clean", async () => {
    await runSolidSHook(["node", "s.mjs", "--files", join(tmpRoot, "gone.ts")]);
    expect(io.exitSpy).not.toHaveBeenCalled();
  });

  test("the thin wrapper main drives a clean --files run", async () => {
    const clean = join(tmpRoot, "wrap.ts");
    await writeFile(clean, "class Ok { a() { this.x; } }\n", "utf8");
    await main(["node", "s.mjs", "--files", clean]);
    expect(io.exitSpy).not.toHaveBeenCalled();
  });
});

describe("solid-s-metrics / --staged diff scope", () => {
  let repo;
  let io;
  let cwd;
  beforeEach(async () => {
    repo = await makeTempGitRepo("solid-s-staged-");
    cwd = process.cwd();
    process.chdir(repo);
    io = mockProcessIo();
  });
  afterEach(async () => {
    io.restore();
    process.chdir(cwd);
    await cleanupTmp(repo);
  });

  test("a newly-staged offender class is caught in --staged scope", async () => {
    await writeFile(join(repo, "bad.ts"), SPLIT_CLASS, "utf8");
    await gitIn(repo, ["add", "bad.ts"]);
    await expect(runSolidSHook(["node", "s.mjs", "--staged"])).rejects.toThrow(
      /__exit__:1/,
    );
    expect(io.text(io.stderrSpy)).toContain("cohesion");
  });

  test("an offender that is committed but untouched by the staged diff is out of scope", async () => {
    await writeFile(join(repo, "old.ts"), SPLIT_CLASS, "utf8");
    await commitAllIn(repo, "seed");
    await writeFile(join(repo, "note.ts"), "export const x = 1;\n", "utf8");
    await gitIn(repo, ["add", "note.ts"]);
    await runSolidSHook(["node", "s.mjs", "--staged"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("in staged diff");
  });
});
