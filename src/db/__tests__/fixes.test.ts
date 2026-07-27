import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRuleFixes, setRuleFixes } from "../fixes.js";
import { openDb, type Db } from "../open.js";
import { addRule } from "../rules.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  addRule(db, { slug: "r1", name: "Rule One" });
});

afterEach(() => {
  db.close();
});

describe("setRuleFixes / getRuleFixes", () => {
  it("round-trips actions in insertion order", () => {
    setRuleFixes(db, "r1", [
      { kind: "output", description: "reports" },
      { kind: "script", scriptPath: "hooks/git/x.mjs", description: "fixes" },
    ]);
    expect(getRuleFixes(db, "r1")).toEqual([
      { kind: "output", description: "reports" },
      { kind: "script", scriptPath: "hooks/git/x.mjs", description: "fixes" },
    ]);
  });

  it("is idempotent — re-set replaces, not appends", () => {
    setRuleFixes(db, "r1", [{ kind: "inferred" }]);
    setRuleFixes(db, "r1", [{ kind: "inferred" }]);
    expect(getRuleFixes(db, "r1")).toEqual([{ kind: "inferred" }]);
  });

  it("clears actions with an empty array", () => {
    setRuleFixes(db, "r1", [{ kind: "output" }]);
    setRuleFixes(db, "r1", []);
    expect(getRuleFixes(db, "r1")).toEqual([]);
  });

  it("accepts inferred/output without a script", () => {
    expect(() => setRuleFixes(db, "r1", [{ kind: "inferred" }])).not.toThrow();
    expect(() => setRuleFixes(db, "r1", [{ kind: "output" }])).not.toThrow();
  });

  it("rejects a script action with no script", () => {
    expect(() => setRuleFixes(db, "r1", [{ kind: "script" }])).toThrow(
      /script action requires/,
    );
  });

  it("throws on an unknown rule", () => {
    expect(() => setRuleFixes(db, "nope", [{ kind: "output" }])).toThrow(
      /unknown rule/,
    );
    expect(() => getRuleFixes(db, "nope")).toThrow(/unknown rule/);
  });
});
