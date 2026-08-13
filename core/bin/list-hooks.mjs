#!/usr/bin/env node
import { resolve } from "node:path";
import { collectHooks, formatHooks } from "../lib/list-hooks.mjs";
import { formatHooksUninstall, uninstallHooks } from "../lib/uninstall.mjs";

function parseArgs(argv) {
  const opts = { command: "list", target: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") opts.target = resolve(argv[(i += 1)]);
    else if (arg === "--json") opts.json = true;
    else if (!arg.startsWith("-")) opts.command = arg;
  }
  return opts;
}

async function runList({ target, json }) {
  const inventory = await collectHooks(target);
  process.stdout.write(
    json
      ? `${JSON.stringify(inventory, null, 2)}\n`
      : `captain-obvious: hooks installed in ${target}\n\n${formatHooks(inventory)}`,
  );
}

// Uninstall applies immediately — no confirmation gate. Removing the managed hooks is
// safely reversible: `captain-obvious-install` wires them all back.
async function runUninstall({ target }) {
  const result = await uninstallHooks(target, { apply: true });
  process.stdout.write(
    `captain-obvious: removing managed hooks in ${target}\n\n${formatHooksUninstall(result, true)}`,
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === "list") return runList(opts);
  if (opts.command === "uninstall") return runUninstall(opts);
  process.stderr.write(
    `captain-obvious: unknown command: ${opts.command} (expected 'list' or 'uninstall')\n`,
  );
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
