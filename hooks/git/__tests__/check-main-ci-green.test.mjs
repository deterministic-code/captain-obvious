import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Drive `gh` deterministically. `promisify(execFile)` calls the mock as
// execFile(cmd, args, opts, cb); we route each `gh` sub-command to a queued
// response set per-test via `ghResponders`.
const ghResponders = { list: null, view: null };
vi.mock("node:child_process", () => ({
  execFile: (cmd, args, opts, cb) => {
    const done = typeof opts === "function" ? opts : cb;
    const sub = args[1];
    const responder = sub === "list" ? ghResponders.list : ghResponders.view;
    if (!responder) {
      done(Object.assign(new Error(`no responder for gh ${args.join(" ")}`)));
      return;
    }
    const { err, stdout = "", stderr = "" } = responder(args);
    if (err) {
      done(Object.assign(err, { stdout, stderr }));
      return;
    }
    done(null, { stdout, stderr });
  },
}));

const {
  blockingJobFailures,
  pickVerdict,
  fetchMainTestsVerdict,
  main,
} = await import("../check-main-ci-green.mjs");

function ghList(runs) {
  ghResponders.list = () => ({ stdout: JSON.stringify(runs) });
}
function ghListRaw(resp) {
  ghResponders.list = () => resp;
}
function ghView(jobs) {
  ghResponders.view = () => ({ stdout: JSON.stringify({ jobs }) });
}
function ghViewRaw(resp) {
  ghResponders.view = () => resp;
}

describe("pickVerdict", () => {
  test("skips cancelled runs and returns the first real verdict", () => {
    const runs = [
      { conclusion: "cancelled", displayTitle: "displaced", url: "u1" },
      { conclusion: "cancelled", displayTitle: "displaced", url: "u2" },
      { conclusion: "failure", displayTitle: "broke it", url: "u3" },
      { conclusion: "success", displayTitle: "older green", url: "u4" },
    ];
    expect(pickVerdict(runs)).toEqual({
      conclusion: "failure",
      displayTitle: "broke it",
      url: "u3",
    });
  });

  test("success verdict wins when it is the most recent real conclusion", () => {
    const runs = [
      { conclusion: "cancelled", displayTitle: "displaced", url: "u1" },
      { conclusion: "success", displayTitle: "green", url: "u2" },
      { conclusion: "failure", displayTitle: "old red", url: "u3" },
    ];
    expect(pickVerdict(runs).conclusion).toBe("success");
  });

  test("in-progress runs (empty conclusion) are not verdicts", () => {
    const runs = [
      { conclusion: "", displayTitle: "running", url: "u1" },
      { conclusion: "failure", displayTitle: "red", url: "u2" },
    ];
    expect(pickVerdict(runs).conclusion).toBe("failure");
  });

  test("no real verdict in the window returns null", () => {
    expect(pickVerdict([{ conclusion: "cancelled" }])).toBeNull();
    expect(pickVerdict([])).toBeNull();
    expect(pickVerdict(null)).toBeNull();
  });
});

describe("blockingJobFailures", () => {
  test("rust and functional failures alone are not blocking", () => {
    const jobs = [
      { name: "unit", conclusion: "success" },
      { name: "integration", conclusion: "success" },
      { name: "rust (cargo test)", conclusion: "failure" },
      { name: "functional (self-hosted)", conclusion: "failure" },
    ];
    expect(blockingJobFailures(jobs)).toEqual([]);
  });

  test("a failed unit job blocks", () => {
    expect(
      blockingJobFailures([{ name: "unit", conclusion: "failure" }]),
    ).toEqual(["unit"]);
  });

  test("a timed-out integration job blocks", () => {
    expect(
      blockingJobFailures([{ name: "integration", conclusion: "timed_out" }]),
    ).toEqual(["integration"]);
  });

  test("cancelled blocking jobs are not failures", () => {
    expect(
      blockingJobFailures([{ name: "unit", conclusion: "cancelled" }]),
    ).toEqual([]);
  });

  test("unknown job data returns null so callers treat the failure as blocking", () => {
    expect(blockingJobFailures(null)).toBeNull();
    expect(blockingJobFailures(undefined)).toBeNull();
  });
});

describe("fetchMainTestsVerdict", () => {
  beforeEach(() => {
    ghResponders.list = null;
    ghResponders.view = null;
  });

  test("gh run list failing (numeric code) reports unavailable", async () => {
    ghListRaw({ err: Object.assign(new Error("boom"), { code: 4 }) });
    const res = await fetchMainTestsVerdict();
    expect(res.verdict).toBeNull();
    expect(res.unavailable).toMatch(/gh run list failed: 4/);
  });

  test("gh run list failing without a code falls back to the message", async () => {
    ghListRaw({ err: new Error("network down") });
    const res = await fetchMainTestsVerdict();
    expect(res.unavailable).toMatch(/gh run list failed: network down/);
  });

  test("non-JSON gh output reports unavailable", async () => {
    ghListRaw({ stdout: "not json{" });
    const res = await fetchMainTestsVerdict();
    expect(res.verdict).toBeNull();
    expect(res.unavailable).toBe("gh returned non-JSON output");
  });

  test("a success verdict passes through with no job lookup", async () => {
    ghList([{ conclusion: "success", displayTitle: "green", url: "u" }]);
    const res = await fetchMainTestsVerdict();
    expect(res.verdict.conclusion).toBe("success");
    expect(res.unavailable).toBeNull();
  });

  test("a failure whose only failed jobs are non-blocking becomes non-blocking-failure", async () => {
    ghList([{ conclusion: "failure", displayTitle: "red", url: "u", databaseId: 7 }]);
    ghView([
      { name: "unit", conclusion: "success" },
      { name: "rust (cargo test)", conclusion: "failure" },
    ]);
    const res = await fetchMainTestsVerdict();
    expect(res.verdict.conclusion).toBe("non-blocking-failure");
  });

  test("a failure with a blocking unit failure stays a hard failure", async () => {
    ghList([{ conclusion: "failure", displayTitle: "red", url: "u", databaseId: 8 }]);
    ghView([{ name: "unit", conclusion: "failure" }]);
    const res = await fetchMainTestsVerdict();
    expect(res.verdict.conclusion).toBe("failure");
  });

  test("a failure whose job list is unavailable (gh view fails) stays a hard failure", async () => {
    ghList([{ conclusion: "failure", displayTitle: "red", url: "u", databaseId: 9 }]);
    ghViewRaw({ err: Object.assign(new Error("boom"), { code: 3 }) });
    const res = await fetchMainTestsVerdict();
    expect(res.verdict.conclusion).toBe("failure");
  });

  test("a failure whose gh view fails without a code falls back to err.message in the warning", async () => {
    ghList([{ conclusion: "failure", displayTitle: "red", url: "u", databaseId: 11 }]);
    ghViewRaw({ err: new Error("gh crashed") });
    const res = await fetchMainTestsVerdict();
    // No blocking-job data → the failure remains blocking.
    expect(res.verdict.conclusion).toBe("failure");
  });

  test("a failure whose gh view returns non-JSON stays a hard failure", async () => {
    ghList([{ conclusion: "failure", displayTitle: "red", url: "u", databaseId: 10 }]);
    ghViewRaw({ stdout: "totally not json" });
    const res = await fetchMainTestsVerdict();
    expect(res.verdict.conclusion).toBe("failure");
  });

  test("no completed run in the window yields a null verdict, no error", async () => {
    ghList([{ conclusion: "cancelled" }]);
    const res = await fetchMainTestsVerdict();
    expect(res.verdict).toBeNull();
    expect(res.unavailable).toBeNull();
  });
});

describe("main", () => {
  let exitSpy;
  let stderrSpy;
  let stdoutSpy;
  beforeEach(() => {
    ghResponders.list = null;
    ghResponders.view = null;
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

  test("--blocking-jobs prints the blocking job names and returns early", async () => {
    await main(["node", "s.mjs", "--blocking-jobs"]);
    expect(stdoutText()).toBe("unit\nintegration\n");
  });

  test("--verdict prints the verdict tuple when one exists", async () => {
    ghList([{ conclusion: "success", displayTitle: "green", url: "u1" }]);
    await main(["node", "s.mjs", "--verdict"]);
    expect(stdoutText()).toBe("success\tgreen\tu1\n");
  });

  test("--verdict prints nothing when there is no verdict", async () => {
    ghList([{ conclusion: "cancelled" }]);
    await main(["node", "s.mjs", "--verdict"]);
    expect(stdoutText()).toBe("");
  });

  test("unavailable verdict allows the commit with a warning", async () => {
    ghListRaw({ err: Object.assign(new Error("boom"), { code: 4 }) });
    await main(["node", "s.mjs"]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/verdict unavailable/);
  });

  test("no completed run allows the commit", async () => {
    ghList([{ conclusion: "cancelled" }]);
    await main(["node", "s.mjs"]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/no completed Tests run found on main/);
  });

  test("non-blocking failure allows the commit", async () => {
    ghList([{ conclusion: "failure", displayTitle: "red", url: "u", databaseId: 7 }]);
    ghView([{ name: "rust (cargo test)", conclusion: "failure" }]);
    await main(["node", "s.mjs"]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/only outside the blocking unit\/integration jobs/);
  });

  test("hard failure blocks and exits 1", async () => {
    ghList([{ conclusion: "failure", displayTitle: "red", url: "u", databaseId: 8 }]);
    ghView([{ name: "unit", conclusion: "failure" }]);
    await expect(main(["node", "s.mjs"], { env: {} })).rejects.toThrow(
      /__exit__:1/,
    );
    expect(stderrText()).toMatch(/BLOCKED: the latest completed Tests run on main FAILED/);
  });

  test("hard failure with ALLOW_COMMIT_ON_RED_MAIN=1 allows the commit", async () => {
    ghList([{ conclusion: "failure", displayTitle: "red", url: "u", databaseId: 8 }]);
    ghView([{ name: "unit", conclusion: "failure" }]);
    await main(["node", "s.mjs"], { env: { ALLOW_COMMIT_ON_RED_MAIN: "1" } });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/ALLOW_COMMIT_ON_RED_MAIN=1 accepted/);
  });

  test("a green verdict prints the green line", async () => {
    ghList([{ conclusion: "success", displayTitle: "green", url: "u1" }]);
    await main(["node", "s.mjs"]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/main Tests run is green/);
  });
});
