import { describe, expect, test } from "vitest";
import { CLASS_LIMITS, analyzeSource } from "../solid-s-metrics.mjs";

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
