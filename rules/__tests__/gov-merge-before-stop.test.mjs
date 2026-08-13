import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "node:child_process";
import { main, stopBlockReason } from "../gov-merge-before-stop/check.mjs";

const execFileMock = vi.mocked(execFile);
const CWD = "/repo";

/**
 * Route git/gh through a scenario. Each git call is keyed by its args after
 * `-C <cwd>`; a value of `null` (or a thrown) simulates the command failing.
 */
function scenario(over = {}) {
  execFileMock.mockImplementation((cmd, args, ...rest) => {
    const cb = rest[rest.length - 1];
    const fail = () => cb(new Error("boom"), null);
    const ok = (stdout) => cb(null, { stdout, stderr: "" });
    if (cmd === "gh" && args[0] === "--version") {
      return over.noGh ? fail() : ok("gh 2\n");
    }
    if (cmd === "gh") return ok(over.prList ?? "[]");
    const key = args.slice(2).join(" ");
    if (key === "rev-parse --is-inside-work-tree")
      return over.notGit ? fail() : ok("true\n");
    if (key === "symbolic-ref --short HEAD")
      return over.branch === null ? fail() : ok(`${over.branch ?? "feature"}\n`);
    if (key === "status --porcelain") return ok(over.status ?? "");
    if (key === "rev-parse --abbrev-ref @{u}")
      return over.noUpstream ? fail() : ok("origin/feature\n");
    if (key === "rev-list --count @{u}..HEAD") return ok(`${over.ahead ?? "0"}\n`);
    if (key.startsWith("rev-list --count main.."))
      return ok(`${over.extra ?? "0"}\n`);
    return ok("");
  });
}

afterEach(() => execFileMock.mockReset());

describe("gov-merge-before-stop / stopBlockReason", () => {
  test("allows outside a git repo", async () => {
    scenario({ notGit: true });
    expect(await stopBlockReason(CWD)).toBeNull();
  });

  test("allows on a protected branch and on a detached HEAD", async () => {
    scenario({ branch: "main" });
    expect(await stopBlockReason(CWD)).toBeNull();
    scenario({ branch: null });
    expect(await stopBlockReason(CWD)).toBeNull();
  });

  test("blocks on uncommitted changes", async () => {
    scenario({ status: " M a.ts\n" });
    expect(await stopBlockReason(CWD)).toMatch(/uncommitted changes/);
  });

  test("blocks on unpushed commits", async () => {
    scenario({ ahead: "2" });
    expect(await stopBlockReason(CWD)).toMatch(/2 local commit/);
  });

  test("ignores an up-to-date or upstream-less branch for the push check", async () => {
    scenario({ ahead: "0" });
    expect(await stopBlockReason(CWD)).toBeNull();
    scenario({ noUpstream: true });
    expect(await stopBlockReason(CWD)).toBeNull();
  });

  test("blocks on an open non-draft PR", async () => {
    scenario({ prList: '[{"number":7,"isDraft":false}]' });
    expect(await stopBlockReason(CWD)).toMatch(/open non-draft PR #7/);
  });

  test("allows a draft PR (nothing to merge yet)", async () => {
    scenario({ prList: '[{"number":7,"isDraft":true}]' });
    expect(await stopBlockReason(CWD)).toBeNull();
  });

  test("blocks on commits not on main when no PR exists", async () => {
    scenario({ prList: "[]", extra: "3" });
    expect(await stopBlockReason(CWD)).toMatch(/3 commit\(s\) not on main/);
  });

  test("allows when no PR and nothing extra on the branch", async () => {
    scenario({ prList: "[]", extra: "0" });
    expect(await stopBlockReason(CWD)).toBeNull();
  });

  test("skips PR checks entirely when gh is unavailable", async () => {
    scenario({ noGh: true, extra: "9" });
    expect(await stopBlockReason(CWD)).toBeNull();
  });

  test("treats empty gh output as no open PR", async () => {
    scenario({ prList: "", extra: "0" });
    expect(await stopBlockReason(CWD)).toBeNull();
  });

  test("honors a custom protected-branch list", async () => {
    scenario({ branch: "release" });
    expect(await stopBlockReason(CWD, { branches: ["release"] })).toBeNull();
  });
});

describe("gov-merge-before-stop / main", () => {
  test("exits 1 and writes the reason to stderr when blocked", async () => {
    scenario({ status: " M a.ts\n" });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`__exit__:${code}`);
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await expect(main(["node", "s"], { cwd: CWD })).rejects.toThrow("__exit__:1");
    expect(stderrSpy.mock.calls.join("")).toMatch(/uncommitted changes/);
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  test("returns without exiting when nothing is unmerged", async () => {
    scenario({ prList: "[]", extra: "0" });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`__exit__:${code}`);
    });
    await main(["node", "s"], { cwd: CWD });
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  test("defaults the cwd to process.cwd() when given no opts", async () => {
    scenario({ prList: "[]", extra: "0" });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`__exit__:${code}`);
    });
    await main(["node", "s"]);
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
