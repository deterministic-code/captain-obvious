import { describe, expect, test } from "vitest";
import {
  JS_TS_EXTS,
  JSCPD_FORMAT_BY_EXT,
  LANGUAGES,
  detect,
} from "../languages.mjs";

describe("detect", () => {
  test("returns the catalog entry for a known extension", () => {
    expect(detect("src/a.tsx").slug).toBe("typescript");
    expect(detect("/abs/path/x.py").slug).toBe("python");
  });

  test("returns null when no language claims the extension", () => {
    expect(detect("notes.zzz")).toBeNull();
    expect(detect("Dockerfile")).toBeNull();
  });
});

describe("derived sets", () => {
  test("JS_TS_EXTS is exactly the JS/TS family (the hooks' old SUPPORTED_EXTS)", () => {
    expect([...JS_TS_EXTS].sort()).toEqual(
      [".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"].sort(),
    );
  });

  test("JS_TS_EXTS excludes languages with their own toolchains", () => {
    expect(JS_TS_EXTS.has(".cs")).toBe(false);
    expect(JS_TS_EXTS.has(".rs")).toBe(false);
  });

  test("JSCPD_FORMAT_BY_EXT maps each JS/TS extension to its jscpd slug", () => {
    expect(JSCPD_FORMAT_BY_EXT[".ts"]).toBe("typescript");
    expect(JSCPD_FORMAT_BY_EXT[".tsx"]).toBe("tsx");
    expect(JSCPD_FORMAT_BY_EXT[".mjs"]).toBe("javascript");
    expect(JSCPD_FORMAT_BY_EXT[".jsx"]).toBe("jsx");
    expect(JSCPD_FORMAT_BY_EXT[".rs"]).toBeUndefined();
  });
});

describe("LANGUAGES catalog", () => {
  test("every entry has a slug, name, and at least one extension", () => {
    for (const l of LANGUAGES) {
      expect(l.slug).toBeTruthy();
      expect(l.name).toBeTruthy();
      expect(l.extensions.length).toBeGreaterThan(0);
    }
  });

  test("slugs are unique", () => {
    const slugs = LANGUAGES.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
