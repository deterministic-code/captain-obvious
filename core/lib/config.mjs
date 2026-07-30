import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Load a repo's captain-obvious config. The config is the per-repo source of truth
 * for which hooks run and in what order — the package ships the hook implementations,
 * the repo owns the wiring (test commands, advisory vs blocking, Claude events).
 *
 * The optional `"mode"` key (`"local"` | `"global"`, default `local`) decides where
 * the registry + audit DBs live — see core/src/db/location.ts. It's read there
 * (synchronously) rather than here, so this loader ignores it.
 */
export async function loadConfig(target, explicitPath) {
  const path = explicitPath ?? join(target, "captain-obvious.config.json");
  const raw = await readFile(path, "utf8").catch((err) => {
    if (err.code === "ENOENT") {
      throw new Error(
        `captain-obvious: no config at ${path}. Create captain-obvious.config.json (see the package README).`,
      );
    }
    throw err;
  });
  return { path, config: JSON.parse(raw) };
}
