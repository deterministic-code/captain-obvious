#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { installGitHooks } from "../lib/git-hooks.mjs";
import { installClaudeHooks } from "../lib/claude-settings.mjs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const opts = { target: process.cwd(), config: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--target") {
      opts.target = resolve(argv[(i += 1)]);
    } else if (argv[i] === "--config") {
      opts.config = resolve(argv[(i += 1)]);
    }
  }
  return opts;
}

async function main() {
  const { target, config: configPath } = parseArgs(process.argv.slice(2));
  const { path, config } = await loadConfig(target, configPath);
  process.stdout.write(`captain-obvious: installing from ${path}\n`);
  const written = [
    ...(await installGitHooks({ target, pkgRoot, gitHooks: config.gitHooks ?? {} })),
    ...(await installClaudeHooks({ target, pkgRoot, claudeHooks: config.claudeHooks })),
  ];
  for (const file of written) {
    process.stdout.write(`captain-obvious: wrote ${file}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
