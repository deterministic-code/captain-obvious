import { describe, expect, it } from "vitest";
import { csv, parseArgs } from "../args.js";

describe("parseArgs", () => {
  it("captures the first positional and ignores later ones", () => {
    const parsed = parseArgs(["lint-x", "extra"]);
    expect(parsed._).toBe("lint-x");
    expect(parsed.values.size).toBe(0);
    expect(parsed.flags.size).toBe(0);
  });

  it("reads --flag value pairs into values", () => {
    const parsed = parseArgs(["--slug", "lint-x", "--name", "X"]);
    expect(parsed.values.get("slug")).toBe("lint-x");
    expect(parsed.values.get("name")).toBe("X");
    expect(parsed._).toBeUndefined();
  });

  it("collects bare boolean flags", () => {
    const parsed = parseArgs(["--enable", "--add"]);
    expect(parsed.flags.has("enable")).toBe(true);
    expect(parsed.flags.has("add")).toBe(true);
    expect(parsed.values.size).toBe(0);
  });

  it("throws when a value flag has no following value", () => {
    expect(() => parseArgs(["--slug"])).toThrow(/missing value for --slug/);
  });

  it("throws when a value flag is followed by another flag", () => {
    expect(() => parseArgs(["--slug", "--name"])).toThrow(
      /missing value for --slug/,
    );
  });
});

describe("csv", () => {
  it("returns an empty array for undefined", () => {
    expect(csv(undefined)).toEqual([]);
  });

  it("returns an empty array for an empty string", () => {
    expect(csv("")).toEqual([]);
  });

  it("splits, trims, and drops empty parts", () => {
    expect(csv(" a , b ,, c ")).toEqual(["a", "b", "c"]);
  });
});
