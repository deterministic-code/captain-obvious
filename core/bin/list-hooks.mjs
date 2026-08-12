#!/usr/bin/env node
import { resolve } from "node:path";
import { collectHooks, formatHooks } from "../lib/list-hooks.mjs";

function parseArgs(argv) {
  const opts = { target: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--target") {
      opts.target = resolve(argv[(i += 1)]);
    } else if (argv[i] === "--json") {
      opts.json = true;
    }
  }
  return opts;
}

async function main() {
  const { target, json } = parseArgs(process.argv.slice(2));
  const inventory = await collectHooks(target);
  process.stdout.write(
    json
      ? `${JSON.stringify(inventory, null, 2)}\n`
      : `captain-obvious: hooks installed in ${target}\n\n${formatHooks(inventory)}`,
  );
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
