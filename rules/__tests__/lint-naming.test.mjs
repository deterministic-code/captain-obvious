import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findViolations,
  formatViolation,
  isPascalCase,
  isValueCase,
  isLintable,
  lintFile,
  main,
  NAMING_EXTS,
} from "../lint-naming/check.mjs";
import { cleanupTmp, mockProcessIo } from "./test-helpers.mjs";

describe("isPascalCase", () => {
  test("PascalCase names pass", () => {
    for (const n of ["EmitPlan", "Datasource", "ID", "App", "A"])
      expect(isPascalCase(n)).toBe(true);
  });
  test("camelCase and snake_case fail", () => {
    for (const n of ["emitPlan", "user_row", "dataSource_x"])
      expect(isPascalCase(n)).toBe(false);
  });
});

describe("isValueCase", () => {
  test("camelCase, PascalCase (React), and UPPER_SNAKE pass", () => {
    for (const n of [
      "fileFormat",
      "GenerateDialog",
      "useBackends",
      "DEFAULT_OPTS",
      "X",
    ])
      expect(isValueCase(n)).toBe(true);
  });
  test("leading/trailing underscores are stripped before judging", () => {
    for (const n of ["__dirname", "_unused", "class_"])
      expect(isValueCase(n)).toBe(true);
  });
  test("snake_case fails", () => {
    for (const n of ["new_version", "file_names", "is_json"])
      expect(isValueCase(n)).toBe(false);
  });
});

describe("findViolations — type-like declarations", () => {
  test("PascalCase class/interface/type/enum produce no violations", () => {
    const src = [
      "class EmitPlan {}",
      "interface Datasource {}",
      "type SettingsKnobs = {};",
      "enum Dialect { Postgres }",
    ].join("\n");
    expect(findViolations(src)).toEqual([]);
  });

  test("snake_case class is flagged as not PascalCase", () => {
    const v = findViolations("class user_row {}\n");
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe("class name not PascalCase");
    expect(v[0].line).toBe(1);
    expect(v[0].col).toBeGreaterThan(0);
  });

  test("camelCase interface and lowercase type alias are flagged", () => {
    const v = findViolations("interface datasource {}\ntype knobs = {};\n");
    expect(v.map((x) => x.kind)).toEqual([
      "interface name not PascalCase",
      "type name not PascalCase",
    ]);
  });

  test("generic type alias `type Foo<T> =` is recognized and passes", () => {
    expect(findViolations("type Box<T> = { v: T };\n")).toEqual([]);
  });
});

describe("findViolations — value declarations", () => {
  test("camelCase / PascalCase / UPPER_SNAKE declarations pass", () => {
    const src = [
      "const fileFormat = 1;",
      "function resolveSettings() {}",
      "const GenerateDialog = () => null;",
      "let DEFAULT_OPTS = {};",
    ].join("\n");
    expect(findViolations(src)).toEqual([]);
  });

  test("snake_case const is flagged", () => {
    const v = findViolations("const new_version = 1;\n");
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe("value name is snake_case");
  });

  test("snake_case function is flagged", () => {
    const v = findViolations("function make_thing() {}\n");
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe("function name is snake_case");
  });

  test("__dirname and other leading-underscore names pass", () => {
    expect(findViolations("const __dirname = x;\n")).toEqual([]);
  });
});

describe("findViolations — false-positive guards", () => {
  test("snake_case object property keys (wire/API shapes) are not declarations, ignored", () => {
    expect(findViolations("return { new_version: newVersion };\n")).toEqual([]);
  });

  test("destructured snake_case (mirroring DB columns) is ignored", () => {
    expect(findViolations("const { backend_id } = row;\n")).toEqual([]);
  });

  test("snake_case inside a template literal (emitted Rust/C#) is ignored", () => {
    const src = "const rust = `let is_json = true;\\nenum foo_bar {}`;\n";
    expect(findViolations(src)).toEqual([]);
  });

  test("snake_case in a string literal or comment is ignored", () => {
    expect(findViolations('const s = "let my_thing = 1";\n')).toEqual([]);
    expect(findViolations("// const my_thing = 1\nconst ok = 1;\n")).toEqual(
      [],
    );
  });

  test("`typeof x` is not mistaken for a type declaration", () => {
    expect(findViolations("const t = typeof window;\n")).toEqual([]);
  });
});

describe("NAMING_EXTS", () => {
  test("covers JS/TS but excludes Rust and C#", () => {
    for (const e of [".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx"])
      expect(NAMING_EXTS.has(e)).toBe(true);
    for (const e of [".rs", ".cs"]) expect(NAMING_EXTS.has(e)).toBe(false);
  });

  test("isLintable with NAMING_EXTS rejects a .rs file", () => {
    expect(isLintable("src/foo.rs", { exts: NAMING_EXTS })).toBe(false);
    expect(isLintable("src/foo.ts", { exts: NAMING_EXTS })).toBe(true);
  });
});

describe("formatViolation", () => {
  test("renders `path:line:col  kind` then indented detail", () => {
    const out = formatViolation({
      path: "src/foo.ts",
      line: 3,
      col: 7,
      kind: "value name is snake_case",
      detail: "explanation",
    });
    expect(out).toBe(
      "src/foo.ts:3:7  value name is snake_case\n    explanation",
    );
  });
});

describe("lintFile", () => {
  let tmpRoot;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "ln-file-"));
  });
  afterEach(async () => {
    await cleanupTmp(tmpRoot);
  });

  test("attaches `.path` to each violation", async () => {
    const p = join(tmpRoot, "bad.ts");
    await writeFile(p, "const bad_name = 1;\n", "utf8");
    const v = await lintFile(p);
    expect(v.length).toBe(1);
    expect(v[0].path).toBe(p);
  });

  test("returns [] for a non-existent path", async () => {
    expect(await lintFile(join(tmpRoot, "nope.ts"))).toEqual([]);
  });
});

describe("main", () => {
  let tmpRoot;
  let io;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "ln-main-"));
    io = mockProcessIo();
  });
  afterEach(async () => {
    io.restore();
    await cleanupTmp(tmpRoot);
  });

  test("no mode prints usage and exits 2", async () => {
    await expect(main(["node", "s.mjs"])).rejects.toThrow(/__exit__:2/);
    expect(io.text(io.stderrSpy)).toMatch(/Usage:/);
  });

  test("--files clean file resolves without exit", async () => {
    const clean = join(tmpRoot, "clean.ts");
    await writeFile(clean, "const fileFormat = 1;\n", "utf8");
    await main(["node", "s.mjs", "--files", clean]);
    expect(io.exitSpy).not.toHaveBeenCalled();
  });

  test("--files snake_case file writes violation and exits 1", async () => {
    const bad = join(tmpRoot, "bad.ts");
    await writeFile(bad, "const bad_name = 1;\n", "utf8");
    await expect(main(["node", "s.mjs", "--files", bad])).rejects.toThrow(
      /__exit__:1/,
    );
    const out = io.text(io.stderrSpy);
    expect(out).toContain("bad_name");
    expect(out).toMatch(/1 violation\(s\)/);
  });

  test("--files ignores a .rs file even with snake_case that would fail as TS", async () => {
    const rs = join(tmpRoot, "lib.rs");
    await writeFile(rs, "let is_json = true;\n", "utf8");
    await main(["node", "s.mjs", "--files", rs]);
    expect(io.exitSpy).not.toHaveBeenCalled();
  });
});
