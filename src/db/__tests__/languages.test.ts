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

// Uses slugs absent from the seeded catalog (haskell/cobol/fortran) so these
// exercise the CLI insert path rather than colliding with a pre-seeded row.
describe("addLanguage", () => {
  it("inserts a language with JSON-encoded extensions", () => {
    const row = addLanguage(db, {
      slug: "haskell",
      name: "Haskell",
      extensions: ["hs", "lhs"],
    });
    expect(row).toMatchObject({ slug: "haskell", name: "Haskell" });
    expect(JSON.parse(row.extensions as string)).toEqual(["hs", "lhs"]);
  });

  it("stores null extensions and is unsupported by default", () => {
    const row = addLanguage(db, { slug: "cobol", name: "COBOL" });
    expect(row.extensions).toBeNull();
    expect(row.is_supported).toBe(0);
  });

  it("rejects a duplicate slug", () => {
    addLanguage(db, { slug: "cobol", name: "COBOL" });
    expect(() => addLanguage(db, { slug: "cobol", name: "COBOL 2" })).toThrow(
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
    expect(() => addLanguage(db, { slug: "fortran", name: "Fortran" })).toThrow(
      /no such table: languages/,
    );
  });
});
