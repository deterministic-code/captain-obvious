#!/usr/bin/env node
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  anyManaged,
  formatDataRemoval,
  formatHooksUninstall,
  removeData,
  uninstallHooks,
} from "../lib/uninstall.mjs";
import { DB_DIR_IGNORE, removeDbIgnore } from "../lib/gitignore.mjs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

function parseArgs(argv) {
  const opts = { target: process.cwd(), yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") opts.target = resolve(argv[(i += 1)]);
    else if (arg === "--yes" || arg === "-y") opts.yes = true;
  }
  return opts;
}

// resolveModeLocation lives in compiled dist (shipped with the package). Absent only
// in an unbuilt monorepo checkout — there we skip data removal rather than guess.
async function resolveDataLocation(target) {
  const locationPath = resolve(pkgRoot, "dist", "db", "location.js");
  if (!(await exists(locationPath))) {
    process.stdout.write(
      "captain-obvious: dist not built — skipping registry data removal (run `npm run build`)\n",
    );
    return { skip: true };
  }
  const { resolveModeLocation } = await import(
    pathToFileURL(locationPath).href
  );
  return { skip: false, location: resolveModeLocation(target) };
}

async function main() {
  const { target, yes } = parseArgs(process.argv.slice(2));
  const header = yes
    ? "uninstalling captain-obvious from"
    : "dry run — uninstalling from";
  process.stdout.write(`captain-obvious: ${header} ${target}\n\n`);

  const hooks = await uninstallHooks(target, { apply: yes });
  process.stdout.write(formatHooksUninstall(hooks, yes));

  const loc = await resolveDataLocation(target);
  const data = loc.skip ? null : await removeData(loc.location, { apply: yes });
  if (data) process.stdout.write(`\n${formatDataRemoval(data, yes)}`);

  const gitignore = await removeDbIgnore(target, { apply: yes });
  if (gitignore.changed) {
    const verb = yes ? "removed" : "would remove";
    process.stdout.write(
      `.gitignore (${gitignore.path}): ${verb} the ${DB_DIR_IGNORE} entry\n`,
    );
  }

  process.stdout.write(
    "\nkept: captain-obvious.config.json (delete it by hand to remove all trace)\n",
  );
  if (
    !yes &&
    (anyManaged(hooks) || (data && data.removed) || gitignore.changed)
  ) {
    process.stdout.write("\nRe-run with --yes to apply.\n");
  }
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
