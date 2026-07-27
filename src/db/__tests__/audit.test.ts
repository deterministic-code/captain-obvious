import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logEvent, openAuditDb, useAuditLog } from "../audit.js";
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
    addLanguage(db, { slug: "go", name: "Go", extensions: ["go"] });
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
