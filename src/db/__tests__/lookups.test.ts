import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireActionTypeId } from "../lookups.js";
import { openDb, type Db } from "../open.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
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
