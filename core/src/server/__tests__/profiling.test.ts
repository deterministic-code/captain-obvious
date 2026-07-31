import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  profilingMeta,
  profilingReport,
  REPORT_METRIC_COLS,
} from "../profiling.js";

const US_PER_MS = 1000;

let dir: string;
let dbPath: string;

interface EventInput {
  tier?: string;
  hook?: string;
  command?: string;
  subcommand?: string;
  status?: string;
  /** Duration in milliseconds; converted to a microsecond start/end span. */
  durationMs?: number;
  /** Event start, in epoch milliseconds (converted to microseconds). */
  startMs?: number;
}

// The profiling DB is a separate file opened read-only with fileMustExist, so the
// fixture must exist on disk with the exact `event` schema profilingReport reads.
function buildDb(events: EventInput[]): void {
  const db = new Database(dbPath);
  db.exec(
    `CREATE TABLE event (
       tier TEXT, hook TEXT, command TEXT, subcommand TEXT, status TEXT,
       start INTEGER, "end" INTEGER
     )`,
  );
  const insert = db.prepare(
    `INSERT INTO event (tier, hook, command, subcommand, status, start, "end")
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const e of events) {
    const startUs = (e.startMs ?? Date.now()) * US_PER_MS;
    const durUs = (e.durationMs ?? 0) * US_PER_MS;
    insert.run(
      e.tier ?? "git",
      e.hook ?? "pre-commit",
      e.command ?? "lint",
      e.subcommand ?? "all",
      e.status ?? "success",
      startUs,
      startUs + durUs,
    );
  }
  db.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "co-profiling-"));
  dbPath = join(dir, "profile.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("profilingMeta", () => {
  it("reports the db path and the event count", () => {
    buildDb([{ hook: "a" }, { hook: "b" }, { hook: "c" }]);
    const meta = profilingMeta(dbPath);
    expect(meta.dbPath).toBe(dbPath);
    expect(meta.count).toBe(3);
  });

  it("throws when the profile db file does not exist", () => {
    expect(() => profilingMeta(join(dir, "missing.db"))).toThrow();
  });
});

describe("REPORT_METRIC_COLS", () => {
  it("lists the fixed metric columns the UI always renders", () => {
    expect(REPORT_METRIC_COLS).toEqual([
      "count",
      "total",
      "avg",
      "p50",
      "p95",
      "failures",
    ]);
  });
});

describe("profilingReport", () => {
  it("groups by the default columns and computes rollups", () => {
    buildDb([
      { hook: "pre-commit", command: "lint", durationMs: 10 },
      { hook: "pre-commit", command: "lint", durationMs: 30 },
      { hook: "pre-push", command: "test", durationMs: 100 },
    ]);
    const report = profilingReport(dbPath, {});
    expect(report.groupCols).toEqual(["tier", "hook", "command", "subcommand"]);
    expect(report.totals).toEqual({ count: 3, total: 140, failures: 0 });
    // Busiest bucket (pre-push/test, 100ms) sorts first.
    expect(report.groups[0].hook).toBe("pre-push");
    expect(report.groups[0].total).toBe(100);
    const lintGroup = report.groups.find((g) => g.hook === "pre-commit");
    if (!lintGroup) throw new Error("expected a pre-commit group");
    expect(lintGroup.count).toBe(2);
    expect(lintGroup.total).toBe(40);
    expect(lintGroup.avg).toBe(20);
  });

  it("echoes a non-existent requested column as a header rendered as '—'", () => {
    buildDb([{ hook: "pre-commit", durationMs: 5 }]);
    // "category" is not a GROUPABLE column: it is echoed in groupCols and the
    // group row, but rendered as the em-dash placeholder.
    const report = profilingReport(dbPath, { group: "hook, category" });
    expect(report.groupCols).toEqual(["hook", "category"]);
    expect(report.groups[0].hook).toBe("pre-commit");
    expect(report.groups[0].category).toBe("—");
  });

  it("filters to the 1h window (timestamps are epoch microseconds)", () => {
    const now = Date.now();
    buildDb([
      { hook: "recent", startMs: now - 60_000, durationMs: 5 },
      { hook: "old", startMs: now - 2 * 3600 * 1000, durationMs: 5 },
    ]);
    const report = profilingReport(dbPath, { last: "1h" });
    expect(report.totals.count).toBe(1);
    expect(report.groups.map((g) => g.hook)).toEqual(["recent"]);
  });

  it("supports the 24h and 7d windows", () => {
    const now = Date.now();
    buildDb([
      { hook: "day", startMs: now - 12 * 3600 * 1000, durationMs: 5 },
      { hook: "week", startMs: now - 3 * 86400 * 1000, durationMs: 5 },
      { hook: "ancient", startMs: now - 30 * 86400 * 1000, durationMs: 5 },
    ]);
    expect(profilingReport(dbPath, { last: "24h" }).totals.count).toBe(1);
    expect(profilingReport(dbPath, { last: "7d" }).totals.count).toBe(2);
  });

  it("ignores an unknown `last` value (no window filter applied)", () => {
    buildDb([
      { hook: "a", startMs: Date.now() - 40 * 86400 * 1000, durationMs: 5 },
    ]);
    expect(profilingReport(dbPath, { last: "99y" }).totals.count).toBe(1);
  });

  it("counts failures and reflects them in the group and totals", () => {
    buildDb([
      { hook: "h", command: "c", status: "failure", durationMs: 10 },
      { hook: "h", command: "c", status: "success", durationMs: 20 },
    ]);
    const report = profilingReport(dbPath, { group: "hook,command" });
    expect(report.groups[0].failures).toBe(1);
    expect(report.totals.failures).toBe(1);
  });

  it("computes percentiles for a single-row bucket", () => {
    buildDb([{ hook: "solo", durationMs: 42 }]);
    const report = profilingReport(dbPath, { group: "hook" });
    const g = report.groups[0];
    expect(g.count).toBe(1);
    expect(g.p50).toBe(42);
    expect(g.p95).toBe(42);
  });

  it("computes nearest-rank percentiles for a many-row bucket", () => {
    // 1..100 ms in one bucket: p50 -> ceil(0.5*100)=50th value=50, p95 -> 95.
    const events = Array.from({ length: 100 }, (_, i) => ({
      hook: "many",
      durationMs: i + 1,
    }));
    buildDb(events);
    const g = profilingReport(dbPath, { group: "hook" }).groups[0];
    expect(g.p50).toBe(50);
    expect(g.p95).toBe(95);
  });

  it("returns empty groups and zero totals for an empty event table", () => {
    buildDb([]);
    const report = profilingReport(dbPath, {});
    expect(report.groups).toEqual([]);
    expect(report.totals).toEqual({ count: 0, total: 0, failures: 0 });
  });

  it("groups everything into one bucket when no real columns are requested", () => {
    // A group of only non-existent columns leaves realCols empty: every event
    // lands in the single "" bucket, and each requested header renders as "—".
    buildDb([{ durationMs: 10 }, { durationMs: 20 }]);
    const report = profilingReport(dbPath, { group: "category" });
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].count).toBe(2);
    expect(report.groups[0].category).toBe("—");
  });

  it("renders a NULL grouping column value as '—'", () => {
    // Insert a row whose `hook` is NULL so the String(r[c] ?? "—") fallback fires.
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE event (
         tier TEXT, hook TEXT, command TEXT, subcommand TEXT, status TEXT,
         start INTEGER, "end" INTEGER
       )`,
    );
    const startUs = Date.now() * US_PER_MS;
    db.prepare(
      `INSERT INTO event (tier, hook, command, subcommand, status, start, "end")
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "git",
      null,
      "lint",
      "all",
      "success",
      startUs,
      startUs + 5 * US_PER_MS,
    );
    db.close();
    const report = profilingReport(dbPath, { group: "hook" });
    expect(report.groups[0].hook).toBe("—");
  });
});
