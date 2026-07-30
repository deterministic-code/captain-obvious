import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeDip,
  constructions,
  fileDipViolations,
  injectableConcretions,
  layerOf,
  runSolidDHook,
} from "../_kit/solid-d-metrics.mjs";
import { parseSourceFile } from "../_kit/fn-metrics.mjs";
import { main } from "../lint-solid-d/check.mjs";
import { cleanupTmp, mockProcessIo } from "./test-helpers.mjs";

const REPO = [
  "export class SparseIndex { append() {} lookup() {} }",
  "export class NotFoundError extends Error { constructor() { super(); } }",
  "export class SkipStep { constructor(public reason: string) {} }",
  "export abstract class BaseService { save() {} }",
].join("\n");

// A service/route file resolving `./collab` to the fixture module above.
const analyze = (path, src) =>
  analyzeDip(path, src, async () => ({
    path: "backend/src/services/collab.ts",
    src: REPO,
  }));

describe("solid-d-metrics / layer detection", () => {
  test.each([
    ["backend/src/routes/custom/x-route.ts", "routes"],
    ["backend/src/services/custom/x-service.ts", "services"],
    ["typescript/src/repositories/mysql/X.ts", "repositories"],
    ["typescript/src/app/services/resolveServices.ts", "app"],
    ["typescript/src/middleware/auth.ts", "middleware"],
    ["typescript/src/util/x.ts", "other"],
  ])("%s → %s", (path, expected) => {
    expect(layerOf(path)).toBe(expected);
  });
});

describe("solid-d-metrics / concretion classification", () => {
  test("a behavioral concrete class is an injectable concretion", () => {
    expect(injectableConcretions(REPO).has("SparseIndex")).toBe(true);
  });
  test("an Error subclass is not (thrown value, not a collaborator)", () => {
    expect(injectableConcretions(REPO).has("NotFoundError")).toBe(false);
  });
  test("a zero-method marker/value class is not", () => {
    expect(injectableConcretions(REPO).has("SkipStep")).toBe(false);
  });
  test("an abstract class is an abstraction, not a concretion", () => {
    expect(injectableConcretions(REPO).has("BaseService")).toBe(false);
  });
  test("a class extending a non-Error base is still a concretion", () => {
    const src =
      "export class Repo extends BaseThing { save() {} }";
    expect(injectableConcretions(src).has("Repo")).toBe(true);
  });
  test("a class extending a qualified (non-identifier) base is a concretion", () => {
    const src = "export class Repo extends ns.Base { save() {} }";
    expect(injectableConcretions(src).has("Repo")).toBe(true);
  });
  test("an implements-only heritage clause is not an extends of Error", () => {
    const src = "export class Repo implements IThing { save() {} }";
    expect(injectableConcretions(src).has("Repo")).toBe(true);
  });
  test("a non-class statement and a class without a name are skipped", () => {
    const src = "export const x = 1;\nexport default class { save() {} }";
    expect([...injectableConcretions(src)]).toEqual([]);
  });
  test("an un-exported class (no modifiers) is not an injectable concretion", () => {
    const src = "class Local { save() {} }";
    expect([...injectableConcretions(src)]).toEqual([]);
  });
  test("constructions finds every `new X` identifier site", () => {
    const sf = parseSourceFile(
      "f.ts",
      "const a = new Foo(); function g() { return new Bar(1); }",
    );
    expect(constructions(sf).map((c) => c.name)).toEqual(["Foo", "Bar"]);
  });
});

describe("solid-d-metrics / analyzeDip violations", () => {
  const service = "backend/src/services/custom/x-service.ts";

  test("a service that constructs a concrete collaborator is flagged", async () => {
    const src = [
      'import { SparseIndex } from "./collab";',
      "export class XService {",
      "  private index = new SparseIndex();",
      "}",
    ].join("\n");
    const v = await analyze(service, src);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("dip");
    expect(v[0].detail).toContain('"SparseIndex"');
  });

  test("injecting the collaborator (no `new`) is clean", async () => {
    const src = [
      'import type { SparseIndex } from "./collab";',
      "export class XService {",
      "  constructor(private readonly index: SparseIndex) {}",
      "}",
    ].join("\n");
    expect(await analyze(service, src)).toHaveLength(0);
  });

  test("constructing an Error or marker is not a DIP violation", async () => {
    const src = [
      'import { NotFoundError, SkipStep } from "./collab";',
      "export class XService {",
      "  fail() { throw new NotFoundError(); }",
      "  skip() { return new SkipStep('x'); }",
      "}",
    ].join("\n");
    expect(await analyze(service, src)).toHaveLength(0);
  });

  test("a solid-d-allow marker opts a composition root out", async () => {
    const src = [
      "// solid-d-allow: composition root wires concrete test modules",
      'import { SparseIndex } from "./collab";',
      "export class Registry {",
      "  private index = new SparseIndex();",
      "}",
    ].join("\n");
    expect(await analyze(service, src)).toHaveLength(0);
  });

  test("app/bootstrap and repositories layers are not checked (factories wire concretions)", async () => {
    const src = [
      'import { SparseIndex } from "./collab";',
      "export class Wiring { private i = new SparseIndex(); }",
    ].join("\n");
    expect(await analyze("typescript/src/app/wire.ts", src)).toHaveLength(0);
    expect(
      await analyze("typescript/src/repositories/build.ts", src),
    ).toHaveLength(0);
  });

  test("constructing a class imported type-only / from a non-value import is not a violation", async () => {
    const src = [
      "export class XService { make() { return new Unknown(); } }",
    ].join("\n");
    expect(await analyze("backend/src/services/x.ts", src)).toHaveLength(0);
  });

  test("constructing a collaborator whose target module fails to resolve is clean", async () => {
    const src = [
      'import { SparseIndex } from "./missing";',
      "export class XService { i = new SparseIndex(); }",
    ].join("\n");
    const v = await analyzeDip(
      "backend/src/services/x.ts",
      src,
      async () => null,
    );
    expect(v).toHaveLength(0);
  });
});

describe("solid-d-metrics / real module resolution + runner", () => {
  let root;
  let io;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "solid-d-run-"));
    io = mockProcessIo();
    await mkdir(join(root, "services"));
    await mkdir(join(root, "repositories"));
  });
  afterEach(async () => {
    io.restore();
    await cleanupTmp(root);
  });

  test("a service constructing a real concrete repository across a resolved import is flagged", async () => {
    await writeFile(
      join(root, "repositories", "index.ts"),
      "export class SparseIndex { append() {} lookup() {} }\n",
      "utf8",
    );
    const svc = join(root, "services", "x.ts");
    await writeFile(
      svc,
      [
        'import { SparseIndex } from "../repositories";',
        "export class XService { i = new SparseIndex(); }",
      ].join("\n"),
      "utf8",
    );
    const v = await fileDipViolations(svc);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("dip");
  });

  test("resolving to a file with an explicit extension also works", async () => {
    await writeFile(
      join(root, "repositories", "store.ts"),
      "export class Store { read() {} }\n",
      "utf8",
    );
    const svc = join(root, "services", "y.ts");
    await writeFile(
      svc,
      [
        'import { Store } from "../repositories/store.ts";',
        "export class YService { s = new Store(); }",
      ].join("\n"),
      "utf8",
    );
    expect(await fileDipViolations(svc)).toHaveLength(1);
  });

  test("fileDipViolations on a missing path is clean", async () => {
    expect(
      await fileDipViolations(join(root, "services", "gone.ts")),
    ).toHaveLength(0);
  });

  test("a second pass over the same files hits the source cache and matches the first", async () => {
    await writeFile(
      join(root, "repositories", "index.ts"),
      "export class SparseIndex { append() {} }\n",
      "utf8",
    );
    const svc = join(root, "services", "cached.ts");
    await writeFile(
      svc,
      [
        'import { SparseIndex } from "../repositories";',
        "export class CachedService { i = new SparseIndex(); }",
      ].join("\n"),
      "utf8",
    );
    const first = await fileDipViolations(svc);
    const second = await fileDipViolations(svc);
    expect(second).toEqual(first);
    expect(second).toHaveLength(1);
  });

  test("a construction whose relative import resolves to no module is clean", async () => {
    const svc = join(root, "services", "unresolved.ts");
    await writeFile(
      svc,
      [
        'import { Ghost } from "../repositories/ghost";',
        "export class GhostService { g = new Ghost(); }",
      ].join("\n"),
      "utf8",
    );
    expect(await fileDipViolations(svc)).toHaveLength(0);
  });

  test("a default value import of a concrete class is tracked and flagged", async () => {
    await writeFile(
      join(root, "repositories", "def.ts"),
      "export default class Store { read() {} }\n",
      "utf8",
    );
    const svc = join(root, "services", "defimport.ts");
    await writeFile(
      svc,
      [
        'import Store from "../repositories/def";',
        "export class DefService { s = new Store(); }",
      ].join("\n"),
      "utf8",
    );
    expect(await fileDipViolations(svc)).toHaveLength(1);
  });

  test("fileDipViolations tolerates a directory that looks like a source file (EISDIR)", async () => {
    const dirPath = join(root, "services", "dir.ts");
    await mkdir(dirPath);
    expect(await fileDipViolations(dirPath)).toHaveLength(0);
  });

  // A permission error is neither ENOENT nor EISDIR, so the cached reader must rethrow it rather than swallow it as "file left the diff".
  test("a non-ENOENT/EISDIR read error (EACCES) is surfaced, not swallowed", async () => {
    const svc = join(root, "services", "locked.ts");
    await writeFile(svc, "export class L {}\n", "utf8");
    await chmod(svc, 0o000);
    try {
      await expect(fileDipViolations(svc)).rejects.toThrow(/EACCES/);
    } finally {
      await chmod(svc, 0o644);
    }
  });

  test("value imports: bare specifiers and type-only names are ignored, default+named tracked", async () => {
    await writeFile(
      join(root, "repositories", "multi.ts"),
      "export class Multi { run() {} }\n",
      "utf8",
    );
    const svc = join(root, "services", "imports.ts");
    await writeFile(
      svc,
      [
        'import { readFile } from "node:fs/promises";',
        'import type { Iface } from "../repositories/multi";',
        'import { Multi } from "../repositories/multi";',
        "export class ImportsService {",
        "  m = new Multi();",
        "  read() { return readFile('x'); }",
        "}",
      ].join("\n"),
      "utf8",
    );
    const v = await fileDipViolations(svc);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain('"Multi"');
  });

  test("runSolidDHook empty argv prints usage and exits 2", async () => {
    await expect(runSolidDHook(["node", "d.mjs"])).rejects.toThrow(
      /__exit__:2/,
    );
    expect(io.text(io.stderrSpy)).toMatch(/Usage/);
  });

  test("runSolidDHook --files on a clean service prints the ok line", async () => {
    const svc = join(root, "services", "clean.ts");
    await writeFile(
      svc,
      "export class CleanService { constructor(private dep) {} }\n",
      "utf8",
    );
    await runSolidDHook(["node", "d.mjs", "--files", svc]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain(
      "SOLID-D: no dependency-inversion violations",
    );
  });

  test("runSolidDHook --files on an offender exits 1 with a dip report", async () => {
    await writeFile(
      join(root, "repositories", "index.ts"),
      "export class SparseIndex { append() {} }\n",
      "utf8",
    );
    const svc = join(root, "services", "bad.ts");
    await writeFile(
      svc,
      [
        'import { SparseIndex } from "../repositories";',
        "export class BadService { i = new SparseIndex(); }",
      ].join("\n"),
      "utf8",
    );
    await expect(
      runSolidDHook(["node", "d.mjs", "--files", svc]),
    ).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toContain("dip");
  });

  test("the thin wrapper main drives a clean --files run", async () => {
    const svc = join(root, "services", "wrap.ts");
    await writeFile(svc, "export class W { constructor(private d) {} }\n", "utf8");
    await main(["node", "d.mjs", "--files", svc]);
    expect(io.exitSpy).not.toHaveBeenCalled();
  });
});
