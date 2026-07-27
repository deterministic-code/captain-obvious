import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureActionType } from "../actions.js";
import { openDb, type Db } from "../open.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("configureActionType", () => {
  it("seeds the fixed action types on open", () => {
    const rows = db
      .prepare("SELECT slug FROM action_types ORDER BY slug")
      .all() as { slug: string }[];
    expect(rows.map((r) => r.slug)).toEqual(["delay_halt", "halt", "warn"]);
  });

  it("renames an existing type", () => {
    const row = configureActionType(db, "delay_halt", { name: "Deferred halt" });
    expect(row).toMatchObject({ slug: "delay_halt", name: "Deferred halt" });
  });

  it("creates a new action type with --add", () => {
    const row = configureActionType(db, "quarantine", {
      add: true,
      name: "Quarantine",
    });
    expect(row).toMatchObject({ slug: "quarantine", name: "Quarantine" });
  });

  it("refuses an unknown type without --add", () => {
    expect(() => configureActionType(db, "quarantine", {})).toThrow(/--add/);
  });

  it("requires an action-type slug", () => {
    expect(() => configureActionType(db, "", {})).toThrow(/requires an/);
  });

  it("defaults the name to the slug when created without one", () => {
    const row = configureActionType(db, "quarantine", { add: true });
    expect(row).toMatchObject({ slug: "quarantine", name: "quarantine" });
  });
});
