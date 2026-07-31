import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  findRepoRoot,
  globalDir,
  resolveMode,
  resolveModeLocation,
} from "../location.js";

const MODE = "CAPTAIN_OBVIOUS_MODE";
const XDG = "XDG_CONFIG_HOME";

// vitest runs with both unset; capture anyway so a set ambient value is restored.
const origMode = process.env[MODE];
const origXdg = process.env[XDG];
const dirs: string[] = [];

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/** A throwaway repo dir; when `config` is given, drops it in as captain-obvious.config.json. */
function tempRepo(config?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "co-loc-"));
  dirs.push(dir);
  if (config !== undefined) {
    writeFileSync(
      join(dir, "captain-obvious.config.json"),
      JSON.stringify(config),
    );
  }
  return dir;
}

afterEach(() => {
  restore(MODE, origMode);
  restore(XDG, origXdg);
  while (dirs.length)
    rmSync(dirs.pop() as string, { recursive: true, force: true });
});

it("findRepoRoot returns the dir holding the config", () => {
  const dir = tempRepo({});
  expect(findRepoRoot(dir)).toBe(dir);
});

it("findRepoRoot walks up to the nearest ancestor config", () => {
  const root = tempRepo({});
  const sub = join(root, "a", "b");
  mkdirSync(sub, { recursive: true });
  expect(findRepoRoot(sub)).toBe(root);
});

it("findRepoRoot returns null when no config exists above the start dir", () => {
  expect(findRepoRoot(tempRepo())).toBeNull();
});

it("resolveMode honours a valid CAPTAIN_OBVIOUS_MODE over everything", () => {
  process.env[MODE] = "global";
  expect(resolveMode(tempRepo({ mode: "local" }))).toBe("global");
});

it("resolveMode throws on an invalid CAPTAIN_OBVIOUS_MODE", () => {
  process.env[MODE] = "sideways";
  expect(() => resolveMode(null)).toThrow(/invalid CAPTAIN_OBVIOUS_MODE/);
});

it("resolveMode reads the mode from the config when no env is set", () => {
  delete process.env[MODE];
  expect(resolveMode(tempRepo({ mode: "global" }))).toBe("global");
});

it("resolveMode throws on an invalid config mode", () => {
  delete process.env[MODE];
  expect(() => resolveMode(tempRepo({ mode: "nope" }))).toThrow(
    /invalid "mode"/,
  );
});

it("resolveMode defaults to local when the config omits mode", () => {
  delete process.env[MODE];
  expect(resolveMode(tempRepo({ plugins: [] }))).toBe("local");
});

it("resolveMode defaults to local when the config file is absent for the root", () => {
  delete process.env[MODE];
  expect(resolveMode(tempRepo())).toBe("local");
});

it("resolveMode defaults to local when there is no repo root", () => {
  delete process.env[MODE];
  expect(resolveMode(null)).toBe("local");
});

it("resolveMode with no arg resolves the root from cwd", () => {
  process.env[MODE] = "local";
  expect(resolveMode()).toBe("local");
});

it("globalDir uses XDG_CONFIG_HOME when set", () => {
  process.env[XDG] = "/xdg/base";
  expect(globalDir()).toBe(join("/xdg/base", "captain-obvious"));
});

it("globalDir falls back to ~/.config when XDG is unset", () => {
  delete process.env[XDG];
  expect(globalDir()).toBe(join(homedir(), ".config", "captain-obvious"));
});

it("globalDir treats a blank XDG_CONFIG_HOME as unset", () => {
  process.env[XDG] = "   ";
  expect(globalDir()).toBe(join(homedir(), ".config", "captain-obvious"));
});

it("resolveModeLocation returns the global dir in global mode", () => {
  process.env[MODE] = "global";
  process.env[XDG] = "/xdg/base";
  const loc = resolveModeLocation(tempRepo({}));
  expect(loc).toEqual({
    mode: "global",
    dir: join("/xdg/base", "captain-obvious"),
  });
});

it("resolveModeLocation ties local mode to <repoRoot>/.captain-obvious", () => {
  delete process.env[MODE];
  const dir = tempRepo({ mode: "local" });
  expect(resolveModeLocation(dir)).toEqual({
    mode: "local",
    dir: join(dir, ".captain-obvious"),
  });
});

it("resolveModeLocation is null in local mode with no repo root to anchor", () => {
  delete process.env[MODE];
  expect(resolveModeLocation(tempRepo())).toBeNull();
});

it("resolveModeLocation with no arg resolves the start dir from cwd", () => {
  process.env[MODE] = "global";
  process.env[XDG] = "/xdg/base";
  expect(resolveModeLocation()).toEqual({
    mode: "global",
    dir: join("/xdg/base", "captain-obvious"),
  });
});
