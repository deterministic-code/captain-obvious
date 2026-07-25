import { describe, expect, test } from "vitest";
import {
  blockingJobFailures,
  pickVerdict,
} from "../check-main-ci-green.mjs";

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
