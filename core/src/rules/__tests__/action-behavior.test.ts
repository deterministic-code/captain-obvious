import { describe, expect, it } from "vitest";
import {
  ACTION_BEHAVIOR,
  actionBehavior,
  DEFAULT_ACTION,
  FIX_ACTIONS,
} from "../action-behavior.js";

describe("actionBehavior", () => {
  it("maps warn to advisory (checks, never blocks, no fix)", () => {
    expect(actionBehavior("warn")).toEqual({
      runsFix: false,
      checks: true,
      blocks: false,
    });
  });

  it("maps halt and delay_halt to a blocking check with no fix", () => {
    expect(actionBehavior("halt")).toEqual({
      runsFix: false,
      checks: true,
      blocks: true,
    });
    expect(actionBehavior("delay_halt")).toEqual(actionBehavior("halt"));
  });

  it("runs the fix without a check for plain fix", () => {
    expect(actionBehavior("fix")).toEqual({
      runsFix: true,
      checks: false,
      blocks: false,
    });
  });

  it("fixes then re-checks for the fix-and-warn / fix-and-halt variants", () => {
    expect(actionBehavior("fix_and_warn")).toEqual({
      runsFix: true,
      checks: true,
      blocks: false,
    });
    expect(actionBehavior("fix_and_halt")).toEqual({
      runsFix: true,
      checks: true,
      blocks: true,
    });
  });

  it("treats an unknown/custom action slug as the blocking default", () => {
    expect(actionBehavior("quarantine")).toEqual(ACTION_BEHAVIOR[DEFAULT_ACTION]);
    expect(DEFAULT_ACTION).toBe("halt");
  });

  it("lists exactly the fix-running actions", () => {
    expect([...FIX_ACTIONS].sort()).toEqual(["fix", "fix_and_halt", "fix_and_warn"]);
  });
});
