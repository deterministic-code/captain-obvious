import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addLanguage } from "../languages.js";
import { openDb, type Db } from "../open.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("addLanguage", () => {
  it("inserts a language with JSON-encoded extensions", () => {
    const row = addLanguage(db, {
      slug: "typescript",
      name: "TypeScript",
      extensions: ["ts", "tsx"],
    });
    expect(row).toMatchObject({ slug: "typescript", name: "TypeScript" });
    expect(JSON.parse(row.extensions as string)).toEqual(["ts", "tsx"]);
  });

  it("stores null extensions when none given", () => {
    const row = addLanguage(db, { slug: "rust", name: "Rust" });
    expect(row.extensions).toBeNull();
  });

  it("rejects a duplicate slug", () => {
    addLanguage(db, { slug: "rust", name: "Rust" });
    expect(() => addLanguage(db, { slug: "rust", name: "Rust 2" })).toThrow(
      /already exists/,
    );
  });

  it("requires slug and name", () => {
    expect(() => addLanguage(db, { slug: "", name: "x" })).toThrow(/requires/);
  });

  it("rethrows a non-unique DB error unchanged", () => {
    // Dropping the table makes the INSERT fail with a "no such table" error,
    // which is NOT a UNIQUE violation, so the catch must rethrow it as-is.
    db.exec("DROP TABLE languages");
    expect(() => addLanguage(db, { slug: "rust", name: "Rust" })).toThrow(
      /no such table: languages/,
    );
  });
});
