import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listHookRuns,
  logEvent,
  openAuditDb,
  recordHookRun,
  resolveAuditDbPath,
  useAuditLog,
} from "../audit.js";
import { configureActionType } from "../actions.js";
import { addLanguage } from "../languages.js";
import { openDb, type Db } from "../open.js";
import { configureRule } from "../rules.js";
import { seedRules } from "../seed.js";
import { RULES } from "../../rules/index.js";

let db: Db;
let audit: Db;

beforeEach(() => {
  db = openDb(":memory:");
  seedRules(db, RULES);
  audit = openAuditDb(":memory:");
  useAuditLog(audit);
});

afterEach(() => {
  useAuditLog(undefined);
  audit.close();
  db.close();
});

function logs(): { log_type: string; message: string }[] {
  return audit
    .prepare("SELECT log_type, message FROM logs ORDER BY id")
    .all() as { log_type: string; message: string }[];
}

describe("audit logging", () => {
  it("records disabling a rule", () => {
    audit.prepare("DELETE FROM logs").run(); // drop the seedRules event
    configureRule(db, "lint-naming", { enabled: false });
    expect(logs()).toEqual([
      { log_type: "rule.disabled", message: "disabled rule lint-naming" },
    ]);
  });

  it("records one event per distinct change in a single configureRule call", () => {
    audit.prepare("DELETE FROM logs").run();
    configureRule(db, "lint-naming", {
      enabled: true,
      setConfig: JSON.stringify({ x: 1 }),
      setAction: { type: "warn", environment: null, delayMs: null },
    });
    expect(logs().map((r) => r.log_type)).toEqual([
      "rule.enabled",
      "rule.configured",
      "severity.set",
    ]);
  });

  it("records adding a language, action type, and seeding", () => {
    audit.prepare("DELETE FROM logs").run();
    addLanguage(db, { slug: "haskell", name: "Haskell", extensions: ["hs"] });
    configureActionType(db, "escalate", { add: true, name: "Escalate" });
    seedRules(db, RULES, { only: "lint-naming" });
    expect(logs().map((r) => r.log_type)).toEqual([
      "language.added",
      "action_type.added",
      "rules.seeded",
    ]);
  });

  it("is a no-op when the sink is disabled", () => {
    useAuditLog(undefined);
    expect(() => logEvent("rule.enabled", "x")).not.toThrow();
    expect(logs()).toEqual([]);
    useAuditLog(audit);
  });

  it("prune deletes rows older than the cutoff and keeps recent ones", () => {
    audit.prepare("DELETE FROM logs").run();
    audit
      .prepare(
        "INSERT INTO logs (log_type, message, created) VALUES (?, ?, datetime('now', '-90 days'))",
      )
      .run("rule.enabled", "old");
    logEvent("rule.disabled", "fresh");

    const info = audit
      .prepare("DELETE FROM logs WHERE created < datetime('now', ?)")
      .run("-30 days");
    expect(info.changes).toBe(1);
    expect(logs()).toEqual([
      { log_type: "rule.disabled", message: "fresh" },
    ]);
  });
});

describe("hook runs", () => {
  it("records a run and lists it back newest-first", () => {
    const base = Date.now();
    recordHookRun(audit, {
      slug: "lint-naming",
      stage: "pre-commit",
      status: "success",
      startedMs: base - 1000,
      durationMs: 12,
    });
    recordHookRun(audit, {
      slug: "lint-dup",
      stage: "pre-push",
      status: "failure",
      startedMs: base,
      durationMs: 40,
    });
    expect(listHookRuns(audit)).toEqual([
      { slug: "lint-dup", stage: "pre-push", status: "failure", started: base },
      { slug: "lint-naming", stage: "pre-commit", status: "success", started: base - 1000 },
    ]);
  });

  it("filters by sinceMs and caps by limit", () => {
    const base = Date.now();
    recordHookRun(audit, { slug: "a", stage: "pre-commit", status: "success", startedMs: base - 5000, durationMs: 1 });
    recordHookRun(audit, { slug: "b", stage: "pre-commit", status: "success", startedMs: base - 2000, durationMs: 1 });
    recordHookRun(audit, { slug: "c", stage: "pre-commit", status: "success", startedMs: base, durationMs: 1 });
    expect(listHookRuns(audit, { sinceMs: base - 3000 }).map((r) => r.slug)).toEqual(["c", "b"]);
    expect(listHookRuns(audit, { limit: 1 }).map((r) => r.slug)).toEqual(["c"]);
  });
});

describe("resolveAuditDbPath", () => {
  // Save/restore so the env cases don't leak into the beforeEach in other suites.
  const savedEnv = process.env.CAPTAIN_OBVIOUS_AUDIT_DB;

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.CAPTAIN_OBVIOUS_AUDIT_DB;
    else process.env.CAPTAIN_OBVIOUS_AUDIT_DB = savedEnv;
  });

  it("passes :memory: through untouched from opts", () => {
    expect(resolveAuditDbPath({ db: ":memory:" })).toBe(":memory:");
  });

  it("resolves a relative opts path to an absolute one", () => {
    expect(resolveAuditDbPath({ db: "rel/audit.db" })).toBe(
      resolve("rel/audit.db"),
    );
  });

  it("passes :memory: through from the env var when no opts", () => {
    process.env.CAPTAIN_OBVIOUS_AUDIT_DB = ":memory:";
    expect(resolveAuditDbPath()).toBe(":memory:");
  });

  it("resolves a relative env path to an absolute one", () => {
    process.env.CAPTAIN_OBVIOUS_AUDIT_DB = "rel/audit.db";
    expect(resolveAuditDbPath()).toBe(resolve("rel/audit.db"));
  });

  it("falls back to the package-local default when neither opts nor env is set", () => {
    delete process.env.CAPTAIN_OBVIOUS_AUDIT_DB;
    expect(resolveAuditDbPath()).toContain(join("data", "audit-log.db"));
  });
});

describe("openAuditDb against a real file", () => {
  it("creates the parent dir recursively and applies the schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "co-audit-"));
    try {
      // A nested (not-yet-existing) dir exercises the recursive mkdir branch.
      const dbPath = join(dir, "nested", "audit.db");
      const db = openAuditDb(dbPath);
      try {
        expect(() => db.prepare("SELECT id FROM logs").all()).not.toThrow();
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
