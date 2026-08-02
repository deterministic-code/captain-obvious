import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/open.js";
import { configureRule } from "../../db/rules.js";
import { seedRules } from "../../db/seed.js";
import { RULES } from "../index.js";
import { selectToolFixes } from "../toolFix.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  seedRules(db, RULES);
});

afterEach(() => {
  db.close();
});

describe("selectToolFixes", () => {
  it("selects the Prettier fix for a file in its language", () => {
    expect(selectToolFixes(db, "src/app.ts")).toContain("lint-prettier");
  });

  it("returns nothing for a file in no catalog language", () => {
    // Markdown isn't in the language catalog, so detect() yields null.
    expect(selectToolFixes(db, "README.md")).toEqual([]);
  });

  it("skips a rule whose languages don't include the file's language", () => {
    // Python is a catalog language, but Prettier only targets TS/JS.
    expect(selectToolFixes(db, "main.py")).not.toContain("lint-prettier");
  });

  it("skips a disabled rule", () => {
    configureRule(db, "lint-prettier", { enabled: false });
    expect(selectToolFixes(db, "src/app.ts")).not.toContain("lint-prettier");
  });
});
