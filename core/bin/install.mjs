#!/usr/bin/env node
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { installGitHooks } from "../lib/git-hooks.mjs";
import { installClaudeHooks } from "../lib/claude-settings.mjs";
import { installNpmScripts } from "../lib/npm-scripts.mjs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

// The discovered rule set from the compiled engine — the single source of truth for
// which rules exist (registry-seeded, no config list). Null when dist isn't built yet
// (install can precede the build); callers degrade to a rule-free install.
async function loadDistRules() {
  const indexPath = resolve(pkgRoot, "dist", "rules", "index.js");
  if (!(await exists(indexPath))) return null;
  const { RULES } = await import(pathToFileURL(indexPath).href);
  return RULES;
}

// Best-effort: warn about external tools a rule's check needs but that aren't
// installed. Skipped when dist isn't built yet; `captain-obvious check-deps` reports
// the same thing on demand. Warn-only.
async function warnMissingDependencies(rules) {
  if (!rules) return;
  const { verifyDependencies, missingRequired } = await import(
    pathToFileURL(resolve(pkgRoot, "dist", "rules", "deps.js")).href
  );
  const { probeDependency } = await import(
    pathToFileURL(resolve(pkgRoot, "dist", "rules", "depProbe.js")).href
  );
  for (const { slug, dep } of missingRequired(
    verifyDependencies(rules, probeDependency),
  )) {
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
  const rules = await loadDistRules();
  if (!rules) {
    process.stdout.write(
      "captain-obvious: dist not built — skipping lint:* script generation (run `npm run build`, then re-install)\n",
    );
  }
  const ruleScripts = (rules ?? []).map((r) => ({
    slug: r.meta.slug,
    stages: r.meta.stages,
    hasCheck: r.checkEntry !== null,
  }));
  const written = [
    ...(await installGitHooks({
      target,
      pkgRoot,
      gitHooks: config.gitHooks ?? {},
    })),
    ...(await installClaudeHooks({
      target,
      pkgRoot,
      claudeHooks: config.claudeHooks,
    })),
    ...(await installNpmScripts({
      target,
      rules: ruleScripts,
      npmScripts: config.npmScripts,
    })),
  ];
  for (const file of written) {
    process.stdout.write(`captain-obvious: wrote ${file}\n`);
  }
  await warnMissingDependencies(rules);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
