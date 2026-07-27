#!/usr/bin/env node
import { configureActionType } from "../db/actions.js";
import { csv, parseArgs, type ParsedArgs } from "../db/args.js";
import { addLanguage } from "../db/languages.js";
import { openDb, resolveDbPath, type Db } from "../db/open.js";
import { addRule, configureRule } from "../db/rules.js";
import { seedRules } from "../db/seed.js";
import type { ActionBinding } from "../db/types.js";
import { RULES } from "../rules/index.js";
import { startServer } from "../server/serve.js";

const USAGE = `usage: captain-obvious <command> [flags]

commands:
  add-language     --slug <s> --name <n> [--ext <csv>]
  add-rule         --slug <s> --name <n> [--category <c>] [--description <d>]
                   [--lang <csv>] [--config <json>] [--hook <csv>]
  configure-rule   <rule-slug> [--set-config <json>] [--enable | --disable]
                   [--add-lang <csv>] [--remove-lang <csv>]
                   [--set-action <type>[:<env>][:<delayMs>]] [--remove-action <env|default|all>]
  configure-action <type-slug> [--add] [--name <n>]
  seed-rules       [--only <slug>]   populate the registry from the bundled rule set
  init             create and seed the registry DB
  serve            [--port <n>] [--host <h>]   run the web control panel + /api

global:
  --db <path>      registry DB path (default: CAPTAIN_OBVIOUS_DB env or data/captain-obvious.db)
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
      description: args.values.get("description"),
      languages: csv(args.values.get("lang")),
      config: args.values.get("config"),
      hooks: csv(args.values.get("hook")),
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

function runInit(args: ParsedArgs): void {
  const path = resolveDbPath({ db: args.values.get("db") });
  const db = openDb(path);
  db.close();
  process.stdout.write(`captain-obvious: initialized registry at ${path}\n`);
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
  init: runInit,
  serve: runServe,
};

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
  try {
    handler(args);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

main(process.argv.slice(2));
