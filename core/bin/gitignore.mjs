#!/usr/bin/env node
import { resolve } from "node:path";
import { DB_DIR_IGNORE, ensureDbIgnored } from "../lib/gitignore.mjs";

function parseArgs(argv) {
  const opts = { target: process.cwd(), check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") opts.target = resolve(argv[(i += 1)]);
    else if (arg === "--check" || arg === "--dry-run") opts.check = true;
  }
  return opts;
}

const MESSAGE = {
  present: (path) => `${DB_DIR_IGNORE} already ignored in ${path}`,
  created: (path) => `created ${path} ignoring ${DB_DIR_IGNORE}`,
  updated: (path) => `added ${DB_DIR_IGNORE} to ${path}`,
};

async function main() {
  const { target, check } = parseArgs(process.argv.slice(2));
  const result = await ensureDbIgnored(target, { apply: !check });
  const suffix = check && result.changed ? " (dry run — not written)" : "";
  process.stdout.write(
    `captain-obvious: ${MESSAGE[result.reason](result.path)}${suffix}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
