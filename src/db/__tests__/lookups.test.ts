import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireActionTypeId, requireHookId } from "../lookups.js";
import { openDb, type Db } from "../open.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("requireHookId", () => {
  it("returns the id of an existing hook", () => {
    const envId = (
      db.prepare("SELECT id FROM environments WHERE slug = ?").get("claude") as {
        id: number;
      }
    ).id;
    const info = db
      .prepare("INSERT INTO hooks (environment_id, slug) VALUES (?, ?)")
      .run(envId, "dispatch-guard");
    expect(requireHookId(db, "dispatch-guard")).toBe(
      Number(info.lastInsertRowid),
    );
  });

  it("throws on an unknown hook", () => {
    expect(() => requireHookId(db, "nope")).toThrow(/unknown hook: nope/);
  });
});

describe("requireActionTypeId", () => {
  it("returns the id of a seeded action type", () => {
    expect(requireActionTypeId(db, "warn")).toBeGreaterThan(0);
  });

  it("throws on an unknown action type", () => {
    expect(() => requireActionTypeId(db, "nope")).toThrow(
      /unknown action type: nope/,
    );
  });
});
