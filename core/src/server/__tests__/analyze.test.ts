import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeProject, analyzeStatus } from "../analyze.js";
import { latestEvent, openAuditDb, useAuditLog } from "../../db/audit.js";

let audit: ReturnType<typeof openAuditDb>;
let root: string;

beforeEach(() => {
  audit = openAuditDb(":memory:");
  useAuditLog(audit);
  root = mkdtempSync(join(tmpdir(), "co-analyze-"));
});

afterEach(() => {
  useAuditLog(undefined);
  audit.close();
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, "");
}

describe("analyzeProject", () => {
  it("tallies languages, recurses real dirs, and skips hidden dirs and unknown files", async () => {
    write("a.ts");
    write("b.ts");
    write("src/f.ts"); // recursion
    write("c.js");
    write("d.py");
    write("e.go");
    write("notes.md"); // unrecognized extension
    write("README"); // no extension
    write("node_modules/x.ts"); // HIDDEN_DIRS
    write(".cache/y.ts"); // dotfile dir
    symlinkSync(join(root, "a.ts"), join(root, "link.ts")); // neither file nor dir dirent

    const result = await analyzeProject(root);

    expect(result.root).toBe(root);
    expect(result.totalFiles).toBe(6);
    expect(result.otherFiles).toBe(2);
    // typescript leads on count; the ties (1 each) fall back to slug order.
    // Each language carries its matched files, relative to root and sorted.
    expect(result.languages).toEqual([
      {
        slug: "typescript",
        name: "TypeScript",
        files: 3,
        paths: ["a.ts", "b.ts", "src/f.ts"],
      },
      { slug: "go", name: "Go", files: 1, paths: ["e.go"] },
      { slug: "javascript", name: "JavaScript", files: 1, paths: ["c.js"] },
      { slug: "python", name: "Python", files: 1, paths: ["d.py"] },
    ]);
  });

  it("logs the scan, which status then reports", async () => {
    expect(analyzeStatus()).toEqual({ analyzed: false, lastAnalyzed: null });
    write("a.ts");
    await analyzeProject(root);
    const status = analyzeStatus();
    expect(status.analyzed).toBe(true);
    expect(typeof status.lastAnalyzed).toBe("string");
  });

  it("summarizes a project with no recognized source files", async () => {
    write("README");
    write("notes.md");
    await analyzeProject(root);
    expect(latestEvent("project.analyzed")?.message).toContain(
      "no recognized source files",
    );
  });

  it("defaults to the current working directory when no path is given", async () => {
    const result = await analyzeProject();
    expect(result.root).toBe(process.cwd());
  });
});

describe("analyzeStatus", () => {
  it("is false when the audit log is disabled", () => {
    useAuditLog(undefined);
    expect(analyzeStatus()).toEqual({ analyzed: false, lastAnalyzed: null });
  });
});
