import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import type { RuleDependency } from "./plugin.js";

const require = createRequire(import.meta.url);

/**
 * Whether a rule's declared dependency is available: npm packages via
 * `require.resolve`, executables via a PATH lookup. A thin platform shim
 * (excluded from coverage); the pure verification logic lives in deps.ts.
 */
export function probeDependency(dep: RuleDependency): boolean {
  if (dep.kind === "npm") {
    try {
      require.resolve(dep.name);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") return false;
      throw err;
    }
  }
  const which = process.platform === "win32" ? "where" : "which";
  return spawnSync(which, [dep.name]).status === 0;
}
