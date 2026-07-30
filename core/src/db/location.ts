import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";

/**
 * Where the registry + audit DBs live. `local` ties them to the project
 * (`<repoRoot>/.captain-obvious/`); `global` shares one set across the machine
 * (`~/.config/captain-obvious/`). Selected by the `mode` key in
 * captain-obvious.config.json, overridable by the CAPTAIN_OBVIOUS_MODE env var.
 */
export type Mode = "local" | "global";

const CONFIG_FILE = "captain-obvious.config.json";

function assertMode(value: unknown, source: string): Mode {
  if (value === "local" || value === "global") return value;
  throw new Error(
    `captain-obvious: invalid ${source}: ${JSON.stringify(value)} (expected "local" or "global")`,
  );
}

/**
 * The repo the tool is installed in: the nearest ancestor of `startDir` holding
 * captain-obvious.config.json. This is the anchor git hooks (cwd = repo top) and
 * `serve` (may run from a subdir) both agree on. Null when there's no config above.
 */
export function findRepoRoot(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  const { root } = parse(dir);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

function modeFromConfig(root: string | null): Mode | null {
  if (!root) return null;
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { mode?: unknown };
  if (parsed.mode === undefined) return null;
  return assertMode(parsed.mode, `"mode" in ${path}`);
}

/** CAPTAIN_OBVIOUS_MODE env wins; else the config's `mode`; else `local`. */
export function resolveMode(root: string | null = findRepoRoot()): Mode {
  const fromEnv = process.env.CAPTAIN_OBVIOUS_MODE;
  if (fromEnv !== undefined) return assertMode(fromEnv, "CAPTAIN_OBVIOUS_MODE");
  return modeFromConfig(root) ?? "local";
}

/** The global DB directory: `$XDG_CONFIG_HOME/captain-obvious` or `~/.config/captain-obvious`. */
export function globalDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() ? xdg : join(homedir(), ".config");
  return join(base, "captain-obvious");
}

export interface ModeLocation {
  mode: Mode;
  dir: string;
}

/**
 * Resolve the mode and the directory both DBs live in. Null when local mode has
 * no repo root to anchor to — callers then fall back to the package-local default.
 */
export function resolveModeLocation(
  startDir: string = process.cwd(),
): ModeLocation | null {
  const root = findRepoRoot(startDir);
  const mode = resolveMode(root);
  if (mode === "global") return { mode, dir: globalDir() };
  if (!root) return null;
  return { mode, dir: join(root, ".captain-obvious") };
}
