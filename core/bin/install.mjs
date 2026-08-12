#!/usr/bin/env node
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { scaffoldConfig } from "../lib/scaffold-config.mjs";
import { installGitHooks } from "../lib/git-hooks.mjs";
import { installClaudeHooks } from "../lib/claude-settings.mjs";
import { installNpmScripts } from "../lib/npm-scripts.mjs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

// Discovered rules: single source of truth; null when dist isn't built (callers degrade).
async function loadDistRules() {
  const indexPath = resolve(pkgRoot, "dist", "rules", "index.js");
  if (!(await exists(indexPath))) return null;
  const { RULES } = await import(pathToFileURL(indexPath).href);
  return RULES;
}

// Best-effort warnings for external tools a rule's check needs (skipped if dist isn't built).
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

// Initialize + seed registry DB (returns { dbPath, summary } or null if dist unavailable).
async function initRegistry({ target, pkgRoot, rules }) {
  if (!rules) return null;
  const openPath = resolve(pkgRoot, "dist", "db", "open.js");
  const seedPath = resolve(pkgRoot, "dist", "db", "seed.js");
  const locationPath = resolve(pkgRoot, "dist", "db", "location.js");
  if (
    !(await exists(openPath)) ||
    !(await exists(seedPath)) ||
    !(await exists(locationPath))
  ) {
    return null;
  }
  const { openDb, resolveDbPath } = await import(pathToFileURL(openPath).href);
  const { seedRules } = await import(pathToFileURL(seedPath).href);
  const { resolveModeLocation } = await import(
    pathToFileURL(locationPath).href
  );
  const dbPath =
    process.env.CAPTAIN_OBVIOUS_DB ||
    (() => {
      const loc = resolveModeLocation(target);
      if (loc) return resolve(loc.dir, "captain-obvious.db");
      return resolve(pkgRoot, "data", "captain-obvious.db");
    })();
  const db = openDb(dbPath);
  try {
    return { dbPath, summary: seedRules(db, rules) };
  } finally {
    db.close();
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

async function installHooks({ config, target, pkgRoot, rules }) {
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
}

async function main() {
  const { target, config: configPath } = parseArgs(process.argv.slice(2));

  if (!configPath) {
    const { created } = await scaffoldConfig({ target });
    if (created) {
      process.stdout.write(
        `captain-obvious: wrote ${resolve(target, "captain-obvious.config.json")}\n`,
      );
    }
  }

  const { path, config } = await loadConfig(target, configPath);
  process.stdout.write(`captain-obvious: installing from ${path}\n`);
  const rules = await loadDistRules();
  if (!rules) {
    process.stdout.write(
      "captain-obvious: dist not built — skipping lint:* (run `npm run build` then re-install)\n",
    );
  }

  await installHooks({ config, target, pkgRoot, rules });
  const registry = await initRegistry({ target, pkgRoot, rules });
  if (registry) {
    const { seeded, languages } = registry.summary;
    const msg = `registry at ${registry.dbPath} — seeded ${seeded.length} rule(s), ${
      languages.length
    } language(s)`;
    process.stdout.write(`captain-obvious: ${msg}\n`);
  } else if (rules) {
    process.stdout.write(
      "captain-obvious: dist/db not built — skipping registry init (run `npm run build`)\n",
    );
  }

  await warnMissingDependencies(rules);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
