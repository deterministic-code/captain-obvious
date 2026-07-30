#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `comments` and `lint-comments` both resolve to rules/lint-comments/check.mjs. */
function scriptFor(name) {
  const stem = name.startsWith("lint-") ? name : `lint-${name}`;
  return join(pkgRoot, "rules", stem, "check.mjs");
}

const [name, ...args] = process.argv.slice(2);
if (!name) {
  process.stderr.write("usage: captain-obvious-lint <hook-name> [args...]\n");
  process.exit(2);
}

const child = spawn(process.execPath, [scriptFor(name), ...args], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
