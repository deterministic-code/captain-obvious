import { describe, expect, it } from "vitest";
import { nameFor } from "../languages.js";

describe("nameFor", () => {
  it("returns the display name for a known language slug", () => {
    expect(nameFor("typescript")).toBe("TypeScript");
  });

  it("falls back to the slug itself when unknown", () => {
    expect(nameFor("cobol")).toBe("cobol");
  });
});
