import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readJson, writeJson } from "../json-file.mjs";
import { installNpmScripts } from "../npm-scripts.mjs";

const rule = (slug, stages, hasCheck = true) => ({ slug, stages, hasCheck });

describe("npm-scripts / installNpmScripts", () => {
  let target;

  beforeEach(async () => {
    target = await mkdtemp(join(tmpdir(), "npm-scripts-"));
  });

  afterEach(async () => {
    await rm(target, { recursive: true, force: true });
  });

  const pkgPath = () => join(target, "package.json");

  test("returns [] when npmScripts is explicitly disabled", async () => {
    expect(
      await installNpmScripts({
        target,
        rules: [],
        npmScripts: { enabled: false },
      }),
    ).toEqual([]);
  });

  test("derives staged/all aliases for a pre-commit rule (no --push)", async () => {
    await writeJson(pkgPath(), { name: "consumer" });
    const written = await installNpmScripts({
      target,
      rules: [rule("lint-comments", ["pre-commit"])],
      npmScripts: {},
    });
    expect(written).toEqual([pkgPath()]);

    const pkg = await readJson(pkgPath());
    expect(pkg.scripts["lint:comments"]).toBe(
      "captain-obvious-lint comments --staged",
    );
    expect(pkg.scripts["lint:comments:all"]).toBe(
      "captain-obvious-lint comments --all",
    );
    expect(pkg.scripts["lint:comments:push"]).toBeUndefined();
    expect(pkg.captainObvious.managedScripts).toEqual([
      "lint:comments",
      "lint:comments:all",
      "panel",
    ]);
  });

  test("derives only a :push alias for a pre-push-only rule", async () => {
    await installNpmScripts({
      target,
      rules: [rule("lint-dup", ["pre-push"])],
      npmScripts: {},
    });
    const pkg = await readJson(pkgPath());
    expect(pkg.scripts["lint:dup:push"]).toBe(
      "captain-obvious-lint dup --push",
    );
    expect(pkg.scripts["lint:dup"]).toBeUndefined();
    expect(pkg.scripts["lint:dup:all"]).toBeUndefined();
  });

  test("a rule bound to both stages gets staged, all, and push aliases", async () => {
    await installNpmScripts({
      target,
      rules: [rule("lint-coverage", ["pre-commit", "pre-push"])],
      npmScripts: {},
    });
    const pkg = await readJson(pkgPath());
    expect(pkg.captainObvious.managedScripts).toEqual([
      "lint:coverage",
      "lint:coverage:all",
      "lint:coverage:push",
      "panel",
    ]);
  });

  test("skips non-lint (governance) and policy-only rules", async () => {
    await installNpmScripts({
      target,
      rules: [
        rule("gov-no-push-to-main", ["pre-push"]),
        rule("lint-require-pr", ["server"], false),
      ],
      npmScripts: {},
    });
    const pkg = await readJson(pkgPath());
    expect(pkg.captainObvious.managedScripts).toEqual(["panel"]);
  });

  test("extraScripts override or add odd aliases", async () => {
    await installNpmScripts({
      target,
      rules: [],
      npmScripts: { extraScripts: { "lint:dead-code": "dead-code --all" } },
    });
    const pkg = await readJson(pkgPath());
    expect(pkg.scripts["lint:dead-code"]).toBe(
      "captain-obvious-lint dead-code --all",
    );
  });

  test("prunes previously-managed scripts that are no longer generated", async () => {
    await writeJson(pkgPath(), {
      scripts: { "lint:gone": "old", keep: "mine" },
      captainObvious: { managedScripts: ["lint:gone"] },
    });
    await installNpmScripts({
      target,
      rules: [rule("lint-comments", ["pre-commit"])],
      npmScripts: {},
    });
    const pkg = await readJson(pkgPath());
    expect(pkg.scripts["lint:gone"]).toBeUndefined();
    expect(pkg.scripts.keep).toBe("mine");
    expect(pkg.scripts["lint:comments"]).toBeDefined();
  });

  test("defaults rules and npmScripts to empty when omitted", async () => {
    const written = await installNpmScripts({ target });
    expect(written).toEqual([pkgPath()]);
    const pkg = await readJson(pkgPath());
    expect(pkg.captainObvious.managedScripts).toEqual(["panel"]);
    expect(pkg.scripts).toEqual({ panel: "captain-obvious serve" });
  });

  test("adds a managed `panel` alias that launches the control panel", async () => {
    await installNpmScripts({
      target,
      rules: [rule("lint-comments", ["pre-commit"])],
      npmScripts: {},
    });
    const pkg = await readJson(pkgPath());
    expect(pkg.scripts.panel).toBe("captain-obvious serve");
    expect(pkg.captainObvious.managedScripts).toContain("panel");
  });

  test("panelScript renames the panel alias key", async () => {
    await installNpmScripts({
      target,
      rules: [],
      npmScripts: { panelScript: "co:panel" },
    });
    const pkg = await readJson(pkgPath());
    expect(pkg.scripts["co:panel"]).toBe("captain-obvious serve");
    expect(pkg.scripts.panel).toBeUndefined();
    expect(pkg.captainObvious.managedScripts).toEqual(["co:panel"]);
  });

  test("panelScript:false drops the panel alias entirely", async () => {
    await installNpmScripts({
      target,
      rules: [rule("lint-comments", ["pre-commit"])],
      npmScripts: { panelScript: false },
    });
    const pkg = await readJson(pkgPath());
    expect(pkg.scripts.panel).toBeUndefined();
    expect(pkg.captainObvious.managedScripts).toEqual([
      "lint:comments",
      "lint:comments:all",
    ]);
  });
});
