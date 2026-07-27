import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readJson, writeJson } from "../json-file.mjs";
import { installNpmScripts } from "../npm-scripts.mjs";

const SCRATCH = "/private/tmp/claude-501/-Users-ryan-Projects-captain-obvious/21d816db-ca11-437f-a0f2-ca45be7dd636/scratchpad";

describe("npm-scripts / installNpmScripts", () => {
  let target;

  beforeEach(async () => {
    target = await mkdtemp(join(SCRATCH, "npm-scripts-"));
  });

  afterEach(async () => {
    await rm(target, { recursive: true, force: true });
  });

  const pkgPath = () => join(target, "package.json");

  test("returns [] when npmScripts is explicitly disabled", async () => {
    expect(
      await installNpmScripts({ target, gitHooks: {}, npmScripts: { enabled: false } }),
    ).toEqual([]);
  });

  test("derives staged/all aliases for each lint hook (no --push)", async () => {
    await writeJson(pkgPath(), { name: "consumer" });
    const written = await installNpmScripts({
      target,
      gitHooks: { preCommit: ["lint-comments"] },
      npmScripts: {},
    });
    expect(written).toEqual([pkgPath()]);

    const pkg = await readJson(pkgPath());
    expect(pkg.scripts["lint:comments"]).toBe("captain-obvious-lint comments --staged");
    expect(pkg.scripts["lint:comments:all"]).toBe("captain-obvious-lint comments --all");
    expect(pkg.scripts["lint:comments:push"]).toBeUndefined();
    expect(pkg.captainObvious.managedScripts).toEqual(["lint:comments", "lint:comments:all"]);
  });

  test("adds a :push alias for prePush hooks flagged with --push", async () => {
    await installNpmScripts({
      target,
      gitHooks: { prePush: ["lint-dup --push"] },
      npmScripts: {},
    });
    const pkg = await readJson(pkgPath());
    expect(pkg.scripts["lint:dup:push"]).toBe("captain-obvious-lint dup --push");
  });

  test("skips bare `run:` passthrough entries", async () => {
    await installNpmScripts({
      target,
      gitHooks: { preCommit: ["run: prettier --check", "lint-naming"] },
      npmScripts: {},
    });
    const pkg = await readJson(pkgPath());
    const keys = pkg.captainObvious.managedScripts;
    expect(keys).toEqual(["lint:naming", "lint:naming:all"]);
    expect(keys.some((k) => k.includes("run"))).toBe(false);
  });

  test("extraScripts override or add odd aliases", async () => {
    await installNpmScripts({
      target,
      gitHooks: {},
      npmScripts: { extraScripts: { "lint:dead-code": "dead-code --all" } },
    });
    const pkg = await readJson(pkgPath());
    expect(pkg.scripts["lint:dead-code"]).toBe("captain-obvious-lint dead-code --all");
  });

  test("prunes previously-managed scripts that are no longer generated", async () => {
    await writeJson(pkgPath(), {
      scripts: { "lint:gone": "old", keep: "mine" },
      captainObvious: { managedScripts: ["lint:gone"] },
    });
    await installNpmScripts({
      target,
      gitHooks: { preCommit: ["lint-comments"] },
      npmScripts: {},
    });
    const pkg = await readJson(pkgPath());
    expect(pkg.scripts["lint:gone"]).toBeUndefined();
    expect(pkg.scripts.keep).toBe("mine");
    expect(pkg.scripts["lint:comments"]).toBeDefined();
  });

  test("defaults gitHooks and npmScripts to empty when omitted", async () => {
    const written = await installNpmScripts({ target });
    expect(written).toEqual([pkgPath()]);
    const pkg = await readJson(pkgPath());
    expect(pkg.captainObvious.managedScripts).toEqual([]);
    expect(pkg.scripts).toEqual({});
  });

  test("merges both preCommit and prePush stems", async () => {
    await installNpmScripts({
      target,
      gitHooks: { preCommit: ["lint-comments"], prePush: ["lint-dup --push"] },
      npmScripts: {},
    });
    const pkg = await readJson(pkgPath());
    expect(pkg.scripts["lint:comments"]).toBeDefined();
    expect(pkg.scripts["lint:dup:push"]).toBeDefined();
  });
});
