import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const execResponders = {};

vi.mock("node:child_process", () => ({
  exec: (cmd, opts, cb) => {
    const done = typeof opts === "function" ? opts : cb;
    const responder = execResponders[cmd];
    if (!responder) {
      done(Object.assign(new Error(`no responder for: ${cmd}`)));
      return;
    }
    try {
      const { err, stdout = "", stderr = "" } = responder();
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        done(err, stdout, stderr);
        return;
      }
      done(null, stdout, stderr);
    } catch (e) {
      done(e);
    }
  },
  execFile: vi.fn(),
}));

const { main } = await import("../gov-tests-green/check.mjs");

function execSuccess(stdout = "", stderr = "") {
  return () => ({ stdout, stderr });
}

function execError(code, stdout = "", stderr = "") {
  const err = new Error("command failed");
  err.code = code;
  return () => ({ err, stdout, stderr });
}

function execTimeout() {
  const err = new Error("command killed");
  err.killed = true;
  err.signal = "SIGTERM";
  return () => ({ err });
}

describe("gov-tests-green", () => {
  let exitSpy;
  let stderrSpy;
  let stdoutSpy;

  beforeEach(() => {
    Object.keys(execResponders).forEach((k) => delete execResponders[k]);
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

  test("passes when tests succeed", async () => {
    execResponders["npm test"] = execSuccess();
    await main(["node", "s.mjs"], { resolveConfig: () => ({}) });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/tests passed/);
  });

  test("halts when tests fail with output", async () => {
    execResponders["npm test"] = execError(
      1,
      "test output on stdout",
      "AssertionError: expected true to be false\n",
    );
    await expect(
      main(["node", "s.mjs"], { resolveConfig: () => ({}) }),
    ).rejects.toThrow(/__exit__:1/);
    expect(stderrText()).toMatch(/test output on stdout/);
    expect(stderrText()).toMatch(/AssertionError/);
    expect(stderrText()).toMatch(/BLOCKED: `npm test` failed \(exit code 1\)/);
  });

  test("halts on timeout", async () => {
    execResponders["npm test"] = execTimeout();
    await expect(
      main(["node", "s.mjs"], { resolveConfig: () => ({}) }),
    ).rejects.toThrow(/__exit__:1/);
    expect(stderrText()).toMatch(/did not finish within 600000ms/);
  });

  test("halts on timeout with custom timeoutMs from config", async () => {
    execResponders["npm test"] = execTimeout();
    await expect(
      main(["node", "s.mjs"], {
        resolveConfig: () => ({ timeoutMs: 30000 }),
      }),
    ).rejects.toThrow(/__exit__:1/);
    expect(stderrText()).toMatch(/did not finish within 30000ms/);
  });

  test("halts when command not found", async () => {
    execResponders["npm test"] = execError(127);
    await expect(
      main(["node", "s.mjs"], { resolveConfig: () => ({}) }),
    ).rejects.toThrow(/__exit__:1/);
    expect(stderrText()).toMatch(/command not found/);
    expect(stderrText()).not.toMatch(/exit code 127/);
  });

  test("bypass env var skips the test suite", async () => {
    const mockResolveConfig = vi.fn(() => {
      throw new Error("should not be called");
    });
    await main(["node", "s.mjs"], {
      env: { ALLOW_COMMIT_ON_RED_TESTS: "1" },
      resolveConfig: mockResolveConfig,
    });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/ALLOW_COMMIT_ON_RED_TESTS=1 accepted/);
    expect(mockResolveConfig).not.toHaveBeenCalled();
  });

  test("uses custom testCommand from config", async () => {
    execResponders["yarn test -- --run"] = execSuccess();
    await main(["node", "s.mjs"], {
      resolveConfig: () => ({ testCommand: "yarn test -- --run" }),
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("falls back to defaults when config is null", async () => {
    execResponders["npm test"] = execSuccess();
    await main(["node", "s.mjs"], {
      resolveConfig: () => null,
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("falls back to defaults when config is undefined", async () => {
    execResponders["npm test"] = execSuccess();
    await main(["node", "s.mjs"], {
      resolveConfig: () => undefined,
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("uses real defaults when opts is omitted entirely", async () => {
    execResponders["npm test"] = execSuccess();
    const original = process.env.ALLOW_COMMIT_ON_RED_TESTS;
    process.env.ALLOW_COMMIT_ON_RED_TESTS = "1";
    try {
      await main(["node", "s.mjs"]);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(stdoutText()).toMatch(/ALLOW_COMMIT_ON_RED_TESTS=1 accepted/);
    } finally {
      if (original === undefined) {
        delete process.env.ALLOW_COMMIT_ON_RED_TESTS;
      } else {
        process.env.ALLOW_COMMIT_ON_RED_TESTS = original;
      }
    }
  });

  test("unhandled errors in config resolution reject the promise", async () => {
    execResponders["npm test"] = execSuccess();
    await expect(
      main(["node", "s.mjs"], {
        resolveConfig: () => {
          throw new Error("config crashed");
        },
      }),
    ).rejects.toThrow(/config crashed/);
  });
});
