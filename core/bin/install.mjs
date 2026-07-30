#!/usr/bin/env node
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { installGitHooks } from "../lib/git-hooks.mjs";
import { installClaudeHooks } from "../lib/claude-settings.mjs";
import { installNpmScripts } from "../lib/npm-scripts.mjs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const exists = (p) => access(p).then(() => true, () => false);

// Best-effort: warn about external tools a rule's check needs but that aren't
// installed. Skipped when dist isn't built yet (install can precede the build);
// `captain-obvious check-deps` reports the same thing on demand. Warn-only.
async function warnMissingDependencies() {
  const depsPath = resolve(pkgRoot, "dist", "rules", "deps.js");
  if (!(await exists(depsPath))) return;
  const { verifyDependencies, missingRequired } = await import(
    pathToFileURL(depsPath).href
  );
  const { probeDependency } = await import(
    pathToFileURL(resolve(pkgRoot, "dist", "rules", "depProbe.js")).href
  );
  const { RULES } = await import(
    pathToFileURL(resolve(pkgRoot, "dist", "rules", "index.js")).href
  );
  for (const { slug, dep } of missingRequired(verifyDependencies(RULES, probeDependency))) {
    const why = dep.reason ? ` — ${dep.reason}` : "";
    process.stdout.write(
      `captain-obvious: warning — rule ${slug} needs ${dep.kind} '${dep.name}'${why}, not found\n`,
    );
  }
}

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
    ...(await installNpmScripts({ target, gitHooks: config.gitHooks ?? {}, npmScripts: config.npmScripts })),
  ];
  for (const file of written) {
    process.stdout.write(`captain-obvious: wrote ${file}\n`);
  }
  await warnMissingDependencies();
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
