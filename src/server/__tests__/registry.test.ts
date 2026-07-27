import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addLanguage } from "../../db/languages.js";
import { openDb, type Db } from "../../db/open.js";
import { addRule } from "../../db/rules.js";
import { listRules } from "../registry.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  addLanguage(db, { slug: "typescript", name: "TypeScript" });
});

afterEach(() => {
  db.close();
});

function view(slug: string) {
  const found = listRules(db).find((r) => r.slug === slug);
  if (!found) throw new Error(`missing rule view: ${slug}`);
  return found;
}

describe("listRules categories", () => {
  it("exposes the full set with the primary first, keeping the scalar category", () => {
    addRule(db, {
      slug: "lint-multi",
      name: "Multi",
      category: "size",
      categories: ["complexity", "naming"],
    });
    const v = view("lint-multi");
    expect(v.category).toBe("size");
    expect(v.categories[0]).toBe("size");
    expect([...v.categories].sort()).toEqual(["complexity", "naming", "size"]);
  });

  it("returns the categories present when a rule has no primary", () => {
    addRule(db, { slug: "lint-no-primary", name: "NP", categories: ["naming"] });
    const v = view("lint-no-primary");
    expect(v.category).toBeNull();
    expect(v.categories).toEqual(["naming"]);
  });

  it("returns an empty set for an uncategorized rule", () => {
    addRule(db, { slug: "lint-bare", name: "Bare" });
    expect(view("lint-bare").categories).toEqual([]);
  });
});
