#!/usr/bin/env node
import { configureActionType } from "../db/actions.js";
import { csv, parseArgs, type ParsedArgs } from "../db/args.js";
import { openAuditDb, resolveAuditDbPath, useAuditLog } from "../db/audit.js";
import { addLanguage } from "../db/languages.js";
import { openDb, resolveDbPath, type Db } from "../db/open.js";
import { addRule, configureRule } from "../db/rules.js";
import { seedRules } from "../db/seed.js";
import type { ActionBinding } from "../db/types.js";
import { probeDependency } from "../rules/depProbe.js";
import { missingRequired, verifyDependencies } from "../rules/deps.js";
import { RULES } from "../rules/index.js";
import { listRules } from "../server/registry.js";
import { startServer } from "../server/serve.js";

const USAGE = `usage: captain-obvious <command> [flags]

commands:
  add-language     --slug <s> --name <n> [--ext <csv>]
  add-rule         --slug <s> --name <n> [--category <c>] [--categories <csv>]
                   [--description <d>] [--lang <csv>] [--config <json>] [--stages <csv>]
  configure-rule   <rule-slug> [--set-config <json>] [--enable | --disable]
                   [--add-lang <csv>] [--remove-lang <csv>]
                   [--add-category <csv>] [--remove-category <csv>] [--set-stages <csv>]
                   [--set-action <type>[:<env>][:<delayMs>]] [--remove-action <env|default|all>]
  configure-action <type-slug> [--add] [--name <n>]
  seed-rules       [--only <slug>]   populate the registry from the bundled rule set
  check-deps       report any missing external tools a rule's check needs (warn-only)
  show-rule        <rule-slug>       print a rule (incl. its actions) as JSON
  init             create and seed the registry DB
  serve            [--port <n>] [--host <h>]   run the web control panel + /api
  prune-logs       [--days <n>]      delete audit logs older than n days (default 30, max 60)

global:
  --db <path>       registry DB path (default: CAPTAIN_OBVIOUS_DB env or data/captain-obvious.db)
  --audit-db <path> audit-log DB path (default: CAPTAIN_OBVIOUS_AUDIT_DB env or data/audit-log.db)
`;

function fail(message: string): never {
  process.stderr.write(`captain-obvious: ${message}\n`);
  process.exit(1);
}

function usage(): never {
  process.stderr.write(USAGE);
  process.exit(2);
}

/** Parse `type[:env][:delayMs]` into an ActionBinding. */
function parseActionBinding(raw: string): ActionBinding {
  const [type, env, delay] = raw.split(":");
  if (!type) throw new Error(`invalid --set-action: ${raw}`);
  return {
    type,
    environment: env ? env : null,
    delayMs: delay ? parseIntStrict(delay, "--set-action delay") : null,
  };
}

function parseIntStrict(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${label} must be an integer: ${value}`);
  return n;
}

function withDb(args: ParsedArgs, fn: (db: Db) => void): void {
  const db = openDb(resolveDbPath({ db: args.values.get("db") }));
  try {
    fn(db);
  } finally {
    db.close();
  }
}

function done(label: string, row: unknown): void {
  process.stdout.write(`captain-obvious: ${label}\n${JSON.stringify(row, null, 2)}\n`);
}

function runAddLanguage(args: ParsedArgs): void {
  withDb(args, (db) => {
    const row = addLanguage(db, {
      slug: args.values.get("slug") ?? "",
      name: args.values.get("name") ?? "",
      extensions: csv(args.values.get("ext")),
    });
    done(`added language ${row.slug}`, row);
  });
}

function runAddRule(args: ParsedArgs): void {
  withDb(args, (db) => {
    const row = addRule(db, {
      slug: args.values.get("slug") ?? "",
      name: args.values.get("name") ?? "",
      category: args.values.get("category"),
      categories: csv(args.values.get("categories")),
      description: args.values.get("description"),
      languages: csv(args.values.get("lang")),
      config: args.values.get("config"),
      stages: csv(args.values.get("stages")),
    });
    done(`added rule ${row.slug}`, row);
  });
}

function runConfigureRule(args: ParsedArgs): void {
  const slug = args._;
  if (!slug) usage();
  if (args.flags.has("enable") && args.flags.has("disable")) {
    fail("--enable and --disable are mutually exclusive");
  }
  const enabled = args.flags.has("enable")
    ? true
    : args.flags.has("disable")
      ? false
      : undefined;
  const setAction = args.values.get("set-action");
  withDb(args, (db) => {
    const row = configureRule(db, slug, {
      setConfig: args.values.get("set-config"),
      enabled,
      addLanguages: csv(args.values.get("add-lang")),
      removeLanguages: csv(args.values.get("remove-lang")),
      addCategories: csv(args.values.get("add-category")),
      removeCategories: csv(args.values.get("remove-category")),
      setStages: args.values.has("set-stages")
        ? csv(args.values.get("set-stages"))
        : undefined,
      setAction: setAction ? parseActionBinding(setAction) : undefined,
      removeAction: args.values.get("remove-action"),
    });
    done(`configured rule ${row.slug}`, row);
  });
}

function runConfigureAction(args: ParsedArgs): void {
  const slug = args._;
  if (!slug) usage();
  withDb(args, (db) => {
    const row = configureActionType(db, slug, {
      add: args.flags.has("add"),
      name: args.values.get("name"),
    });
    done(`configured action ${row.slug}`, row);
  });
}

function runSeedRules(args: ParsedArgs): void {
  withDb(args, (db) => {
    const summary = seedRules(db, RULES, { only: args.values.get("only") });
    done(
      `seeded ${summary.seeded.length} rule(s), ${summary.languages.length} language(s)`,
      summary,
    );
  });
}

function runCheckDeps(_args: ParsedArgs): void {
  const statuses = verifyDependencies(RULES, probeDependency);
  const missing = missingRequired(statuses);
  if (missing.length === 0) {
    process.stdout.write(
      `captain-obvious: all ${statuses.length} declared rule dependencies are present\n`,
    );
    return;
  }
  for (const { slug, dep } of missing) {
    const why = dep.reason ? ` — ${dep.reason}` : "";
    process.stderr.write(
      `captain-obvious: [${slug}] missing ${dep.kind} dependency '${dep.name}'${why}\n`,
    );
  }
}

function runInit(args: ParsedArgs): void {
  const path = resolveDbPath({ db: args.values.get("db") });
  const db = openDb(path);
  db.close();
  process.stdout.write(`captain-obvious: initialized registry at ${path}\n`);
}

function runShowRule(args: ParsedArgs): void {
  const slug = args._;
  if (!slug) usage();
  withDb(args, (db) => {
    const rule = listRules(db).find((r) => r.slug === slug);
    if (!rule) fail(`unknown rule: ${slug}`);
    done(`rule ${slug}`, rule);
  });
}

const MAX_PRUNE_DAYS = 60;
const DEFAULT_PRUNE_DAYS = 30;

function runPruneLogs(args: ParsedArgs): void {
  const daysRaw = args.values.get("days");
  const days = daysRaw ? parseIntStrict(daysRaw, "--days") : DEFAULT_PRUNE_DAYS;
  if (days < 1 || days > MAX_PRUNE_DAYS) {
    fail(`--days must be between 1 and ${MAX_PRUNE_DAYS}`);
  }
  const db = openAuditDb(resolveAuditDbPath({ db: args.values.get("audit-db") }));
  try {
    const info = db
      .prepare("DELETE FROM logs WHERE created < datetime('now', ?)")
      .run(`-${days} days`);
    process.stdout.write(
      `captain-obvious: pruned ${info.changes} log(s) older than ${days} day(s)\n`,
    );
  } finally {
    db.close();
  }
}

function runServe(args: ParsedArgs): void {
  const portRaw = args.values.get("port");
  startServer({
    port: portRaw ? parseIntStrict(portRaw, "--port") : undefined,
    host: args.values.get("host"),
    dbPath: args.values.get("db"),
  }).catch((err) => fail(err instanceof Error ? err.message : String(err)));
}

const COMMANDS: Record<string, (args: ParsedArgs) => void> = {
  "add-language": runAddLanguage,
  "add-rule": runAddRule,
  "configure-rule": runConfigureRule,
  "configure-action": runConfigureAction,
  "seed-rules": runSeedRules,
  "check-deps": runCheckDeps,
  "show-rule": runShowRule,
  init: runInit,
  serve: runServe,
  "prune-logs": runPruneLogs,
};

/** Commands that change registry state; only these open the audit-log sink. */
const MUTATING_COMMANDS = new Set([
  "add-language",
  "add-rule",
  "configure-rule",
  "configure-action",
  "seed-rules",
]);

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") usage();
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`captain-obvious: unknown command: ${command}\n`);
    usage();
  }
  let args: ParsedArgs;
  try {
    args = parseArgs(rest);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const auditDb = MUTATING_COMMANDS.has(command)
    ? openAuditDb(resolveAuditDbPath({ db: args.values.get("audit-db") }))
    : undefined;
  if (auditDb) useAuditLog(auditDb);
  try {
    handler(args);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  } finally {
    if (auditDb) {
      useAuditLog(undefined);
      auditDb.close();
    }
  }
}

main(process.argv.slice(2));
