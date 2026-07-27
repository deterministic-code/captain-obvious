import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { main } from "../gov-no-push-to-main.mjs";
import { cleanupTmp, gitIn, makeTempGitRepo } from "./test-helpers.mjs";

describe("gov-no-push-to-main / main", () => {
  let exitSpy;
  let stderrSpy;
  let stdoutSpy;
  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`__exit__:${code}`);
    });
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });
  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  const stderrText = () => stderrSpy.mock.calls.map((c) => c[0]).join("");
  const stdoutText = () => stdoutSpy.mock.calls.map((c) => c[0]).join("");

  test("ALLOW_EDIT_ON_MAIN=1 short-circuits and allows work without a branch check", async () => {
    await main(["node", "s.mjs"], {
      env: { ALLOW_EDIT_ON_MAIN: "1" },
      cwd: "/does/not/matter",
    });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/ALLOW_EDIT_ON_MAIN=1 accepted/);
  });

  test("blocks and exits 1 on a protected branch (main)", async () => {
    const repo = await makeTempGitRepo("gnptm-main-");
    await gitIn(repo, ["commit", "--allow-empty", "-q", "-m", "seed"]);
    await expect(
      main(["node", "s.mjs"], { env: {}, cwd: repo }),
    ).rejects.toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrText()).toMatch(/BLOCKED: you are on protected branch 'main'/);
    await cleanupTmp(repo);
  });

  test("allows a non-protected feature branch", async () => {
    const repo = await makeTempGitRepo("gnptm-feat-");
    await gitIn(repo, ["commit", "--allow-empty", "-q", "-m", "seed"]);
    await gitIn(repo, ["checkout", "-q", "-b", "feature/x"]);
    await main(["node", "s.mjs"], { env: {}, cwd: repo });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/on 'feature\/x' — not a protected branch/);
    await cleanupTmp(repo);
  });

  test("defaults env to process.env and cwd to process.cwd() when opts is omitted", async () => {
    // Cover both defaults without depending on the branch of the checkout
    // running the suite (it may be on main). The cwd default (`?? process.cwd()`)
    // is evaluated before the ALLOW_EDIT_ON_MAIN short-circuit returns, so an
    // omitted cwd is exercised here without the real cwd ever being read.
    await main(["node", "s.mjs"], { env: { ALLOW_EDIT_ON_MAIN: "1" } });
    expect(stdoutText()).toMatch(/ALLOW_EDIT_ON_MAIN=1 accepted/);
    expect(exitSpy).not.toHaveBeenCalled();

    // The env default (`?? process.env`, which carries no ALLOW_EDIT_ON_MAIN)
    // with cwd pointed at a temp repo on a feature branch — a deterministic
    // non-protected result regardless of the suite's own checkout.
    const prev = process.env.ALLOW_EDIT_ON_MAIN;
    delete process.env.ALLOW_EDIT_ON_MAIN;
    const repo = await makeTempGitRepo("gnptm-default-");
    await gitIn(repo, ["commit", "--allow-empty", "-q", "-m", "seed"]);
    await gitIn(repo, ["checkout", "-q", "-b", "feature/x"]);
    try {
      await main(["node", "s.mjs"], { cwd: repo });
    } finally {
      if (prev === undefined) delete process.env.ALLOW_EDIT_ON_MAIN;
      else process.env.ALLOW_EDIT_ON_MAIN = prev;
      await cleanupTmp(repo);
    }
    expect(stdoutText()).toMatch(/on 'feature\/x' — not a protected branch/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("detached HEAD (symbolic-ref fails) is treated as not protected", async () => {
    const repo = await makeTempGitRepo("gnptm-detached-");
    await gitIn(repo, ["commit", "--allow-empty", "-q", "-m", "seed"]);
    const { stdout } = await gitIn(repo, ["rev-parse", "HEAD"]);
    await gitIn(repo, ["checkout", "-q", stdout.trim()]);
    await main(["node", "s.mjs"], { env: {}, cwd: repo });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/on 'detached HEAD' — not a protected branch/);
    await cleanupTmp(repo);
  });
});
