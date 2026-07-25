import { describe, expect, test } from "vitest";
import {
  analyzeDip,
  constructions,
  injectableConcretions,
  layerOf,
} from "../solid-d-metrics.mjs";
import { parseSourceFile } from "../fn-metrics.mjs";

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
});
