import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAuditDb, listLogs, recordHookRun } from "../../db/audit.js";
import { openDb, type Db } from "../../db/open.js";
import { addRule } from "../../db/rules.js";
import {
  activityFeed,
  activitySummary,
  keyToSlug,
  slugToKey,
} from "../activity.js";

const US_PER_MS = 1000;
const HOUR = 3600_000;

let dir: string;
let profilePath: string;
let audit: Db;
let db: Db;

interface EventInput {
  command?: string;
  subcommand?: string | null;
  status?: string;
  /** Event start, in epoch milliseconds (converted to microseconds on write). */
  startMs: number;
}

// The profile DB is opened read-only with fileMustExist, so the fixture must
// exist on disk with the exact `event` columns activity.ts reads.
function buildProfile(events: EventInput[]): void {
  const db = new Database(profilePath);
  db.exec(
    `CREATE TABLE event (
       command TEXT, subcommand TEXT, status TEXT, start INTEGER, "end" INTEGER
     )`,
  );
  const insert = db.prepare(
    `INSERT INTO event (command, subcommand, status, start, "end") VALUES (?, ?, ?, ?, ?)`,
  );
  for (const e of events) {
    const startUs = e.startMs * US_PER_MS;
    insert.run(
      e.command ?? "npm",
      e.subcommand === undefined ? "lint:naming" : e.subcommand,
      e.status ?? "success",
      startUs,
      startUs,
    );
  }
  db.close();
}

function addLog(logType: string, message: string, atMs: number): void {
  audit
    .prepare("INSERT INTO logs (log_type, message, created) VALUES (?, ?, ?)")
    .run(
      logType,
      message,
      new Date(atMs).toISOString().slice(0, 19).replace("T", " "),
    );
}

function addDispatchRun(
  slug: string,
  atMs: number,
  {
    stage = "pre-commit",
    status = "success" as "success" | "failure",
    found = null as number | null,
  } = {},
): void {
  recordHookRun(audit, {
    slug,
    stage,
    status,
    startedMs: atMs,
    durationMs: 5,
    found,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "co-activity-"));
  profilePath = join(dir, "profile.db");
  audit = openAuditDb(join(dir, "audit.db"));
  // The registry the feed reads languages from. lint-dup carries two so the
  // feed can prove it surfaces the full set; lint-naming carries one.
  db = openDb(":memory:");
  // lint-naming carries no description, so the feed's message falls back to its
  // name; lint-dup carries one, so the feed surfaces the description verbatim.
  addRule(db, {
    slug: "lint-naming",
    name: "Naming",
    languages: ["typescript"],
  });
  addRule(db, {
    slug: "lint-dup",
    name: "Dup",
    description: "Flags duplicated code",
    languages: ["javascript", "typescript"],
  });
});

afterEach(() => {
  audit.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("slug ↔ key mapping", () => {
  it("swaps the lint prefix both ways and leaves other slugs alone", () => {
    expect(slugToKey("lint-naming")).toBe("lint:naming");
    expect(slugToKey("gov-require-pr")).toBe("gov-require-pr");
    expect(keyToSlug("lint:dup-fn")).toBe("lint-dup-fn");
    expect(keyToSlug("commit")).toBe("commit");
  });
});

describe("activityFeed fixed-count message", () => {
  it("formats the files-fixed count for a fix run, singular and plural", () => {
    const now = Date.now();
    recordHookRun(audit, {
      slug: "lint-dup",
      stage: "fix",
      status: "success",
      startedMs: now,
      durationMs: 5,
      fixed: 1,
    });
    recordHookRun(audit, {
      slug: "lint-naming",
      stage: "fix",
      status: "success",
      startedMs: now,
      durationMs: 5,
      fixed: 3,
    });
    const feed = activityFeed(undefined, audit, db, { last: "24h" });
    const msg = new Map(
      feed.filter((e) => e.source === "hook").map((e) => [e.key, e.message]),
    );
    expect(msg.get("lint:dup")).toBe("1 file fixed");
    expect(msg.get("lint:naming")).toBe("3 files fixed");
  });
});

describe("activitySummary", () => {
  it("ranks keys by run count, counts failures, and lists all keys sorted", () => {
    const now = Date.now();
    buildProfile([
      { subcommand: "lint:naming", startMs: now - HOUR },
      { subcommand: "lint:naming", status: "failure", startMs: now - 2 * HOUR },
      { subcommand: "lint:dup", startMs: now - 3 * HOUR },
      { command: "git", subcommand: null, startMs: now - 4 * HOUR },
    ]);
    const s = activitySummary(profilePath, audit, { last: "24h" });
    expect(s.keys).toEqual(["git", "lint:dup", "lint:naming"]);
    expect(s.top[0]).toEqual({ key: "lint:naming", runs: 2, failures: 1 });
    // Null subcommand falls back to the command as the key.
    expect(s.top.map((t) => t.key)).toContain("git");
    // 24 buckets over the 24h window; runs land in them and sum to the total.
    expect(s.series.buckets).toHaveLength(24);
    const total = s.series.buckets.reduce((n, b) => n + b.runs, 0);
    expect(total).toBe(4);
    const fails = s.series.buckets.reduce((n, b) => n + b.failures, 0);
    expect(fails).toBe(1);
  });

  it("scopes top + series to the rules filter but keeps keys complete", () => {
    const now = Date.now();
    buildProfile([
      { subcommand: "lint:naming", startMs: now - HOUR },
      { subcommand: "lint:dup", startMs: now - HOUR },
    ]);
    const s = activitySummary(profilePath, audit, {
      last: "24h",
      rules: "lint:naming",
    });
    expect(s.keys).toEqual(["lint:dup", "lint:naming"]);
    expect(s.top).toEqual([{ key: "lint:naming", runs: 1, failures: 0 }]);
    expect(s.series.buckets.reduce((n, b) => n + b.runs, 0)).toBe(1);
  });

  it("caps the top list at 10 keys", () => {
    const now = Date.now();
    buildProfile(
      Array.from({ length: 12 }, (_, i) => ({
        subcommand: `lint:r${i}`,
        startMs: now - HOUR,
      })),
    );
    expect(
      activitySummary(profilePath, audit, { last: "24h" }).top,
    ).toHaveLength(10);
  });

  it("clamps an event at 'now' into the last bucket and defaults an unknown window to 7d", () => {
    const now = Date.now();
    buildProfile([{ subcommand: "lint:naming", startMs: now }]);
    const sevenDayBucket = Math.round((604800 * 1000) / 24);
    const s = activitySummary(profilePath, audit, { last: "bogus" });
    // 7d default → 7*24*3600*1000/24 ms per bucket.
    expect(s.series.bucketMs).toBe(sevenDayBucket);
    expect(s.series.buckets[23].runs).toBe(1);
    // Omitting `last` entirely also resolves to the 7d default.
    expect(activitySummary(profilePath, audit, {}).series.bucketMs).toBe(
      sevenDayBucket,
    );
  });

  it("returns empty structures when there is no activity in the window", () => {
    buildProfile([
      { subcommand: "lint:naming", startMs: Date.now() - 10 * 86400_000 },
    ]);
    const s = activitySummary(profilePath, audit, { last: "1h" });
    expect(s.keys).toEqual([]);
    expect(s.top).toEqual([]);
    expect(s.series.buckets.every((b) => b.runs === 0)).toBe(true);
  });

  it("merges the dispatcher's own runs with the profiler's, keyed by slug", () => {
    const now = Date.now();
    buildProfile([{ subcommand: "lint:naming", startMs: now - HOUR }]);
    // A dispatch run of lint-naming lands in the same lint:naming bucket.
    addDispatchRun("lint-naming", now - 2 * HOUR);
    addDispatchRun("lint-dup", now - 3 * HOUR, { status: "failure" });
    const s = activitySummary(profilePath, audit, { last: "24h" });
    expect(s.keys).toEqual(["lint:dup", "lint:naming"]);
    expect(s.top.find((t) => t.key === "lint:naming")).toEqual({
      key: "lint:naming",
      runs: 2,
      failures: 0,
    });
    expect(s.top.find((t) => t.key === "lint:dup")).toEqual({
      key: "lint:dup",
      runs: 1,
      failures: 1,
    });
  });

  it("summarises dispatch runs even when the profile DB is absent", () => {
    const now = Date.now();
    addDispatchRun("lint-naming", now - HOUR);
    const s = activitySummary(undefined, audit, { last: "24h" });
    expect(s.keys).toEqual(["lint:naming"]);
    expect(s.top).toEqual([{ key: "lint:naming", runs: 1, failures: 0 }]);
    expect(s.series.buckets.reduce((n, b) => n + b.runs, 0)).toBe(1);
  });
});

describe("activityFeed", () => {
  it("merges hook runs and audit logs newest-first with statuses", () => {
    const now = Date.now();
    buildProfile([
      { subcommand: "lint:naming", status: "failure", startMs: now - HOUR },
      { subcommand: "lint:dup", startMs: now - 3 * HOUR },
    ]);
    addLog("rule.enabled", "enabled lint-naming", now - 2 * HOUR);
    const feed = activityFeed(profilePath, audit, db, { last: "24h" });
    expect(feed.map((e) => [e.source, e.key])).toEqual([
      ["hook", "lint:naming"],
      ["log", "rule.enabled"],
      ["hook", "lint:dup"],
    ]);
    expect(feed[0]).toMatchObject({
      status: "failure",
      detail: "npm lint:naming",
    });
    expect(feed[2]).toMatchObject({ status: "success" });
  });

  it("filters hooks by key and logs by the mapped rule slug", () => {
    const now = Date.now();
    buildProfile([
      { subcommand: "lint:naming", startMs: now - HOUR },
      { subcommand: "lint:dup", startMs: now - HOUR },
    ]);
    addLog("rule.enabled", "enabled lint-naming", now - HOUR);
    addLog("rule.enabled", "enabled lint-dup", now - HOUR);
    const feed = activityFeed(profilePath, audit, db, {
      last: "24h",
      rules: "lint:naming",
    });
    expect(feed.map((e) => e.key + ":" + e.source)).toEqual([
      "lint:naming:hook",
      "rule.enabled:log",
    ]);
    expect(feed.every((e) => e.detail.includes("naming"))).toBe(true);
  });

  it("streams only logs when the profile DB is absent, and honours the limit", () => {
    const now = Date.now();
    // Inserted oldest-first, as real logging appends them (id order == time order).
    addLog("rule.disabled", "c", now - 3 * HOUR);
    addLog("action.set", "b", now - 2 * HOUR);
    addLog("rule.enabled", "a", now - HOUR);
    const feed = activityFeed(undefined, audit, db, { last: "24h", limit: 2 });
    expect(feed).toHaveLength(2);
    expect(feed.every((e) => e.source === "log")).toBe(true);
    expect(feed[0].detail).toBe("a");
  });

  it("carries the dispatcher's stage and rule languages on hook rows; log rows have neither", () => {
    const now = Date.now();
    addDispatchRun("lint-naming", now - HOUR, {
      stage: "pre-push",
      status: "failure",
    });
    addLog("rule.enabled", "enabled lint-dup", now - 2 * HOUR);
    const feed = activityFeed(undefined, audit, db, { last: "24h" });
    expect(feed.map((e) => [e.source, e.key])).toEqual([
      ["hook", "lint:naming"],
      ["log", "rule.enabled"],
    ]);
    expect(feed[0]).toMatchObject({
      status: "failure",
      detail: "lint-naming",
      stage: "pre-push",
      languages: ["typescript"],
      // No registry description, so the message falls back to the rule name.
      message: "Naming",
    });
    // A config-change row is neither staged, language-scoped, nor summarised.
    expect(feed[1].stage).toBeUndefined();
    expect(feed[1].languages).toBeUndefined();
    expect(feed[1].message).toBeUndefined();
  });

  it("surfaces every language a rule targets and empties the list for an unknown rule", () => {
    const now = Date.now();
    addDispatchRun("lint-dup", now - HOUR);
    // lint-solid is never registered, so there is no language mapping for it.
    addDispatchRun("lint-solid", now - 2 * HOUR);
    const feed = activityFeed(undefined, audit, db, { last: "24h" });
    expect(feed.find((e) => e.key === "lint:dup")?.languages).toEqual([
      "javascript",
      "typescript",
    ]);
    expect(feed.find((e) => e.key === "lint:solid")?.languages).toEqual([]);
    // A known rule surfaces its registry description; an unknown one has none.
    expect(feed.find((e) => e.key === "lint:dup")?.message).toBe(
      "Flags duplicated code",
    );
    expect(feed.find((e) => e.key === "lint:solid")?.message).toBeUndefined();
  });

  it("makes the per-run count the message, overriding the registry description", () => {
    const now = Date.now();
    // lint-dup carries a description, but a run that reported a count shows the
    // count instead — the outcome wins over the static summary.
    addDispatchRun("lint-dup", now - HOUR, { found: 4, status: "failure" });
    // A single violation reads in the singular.
    addDispatchRun("lint-naming", now - 2 * HOUR, {
      found: 1,
      status: "failure",
    });
    // Zero is still a count, not the description fallback.
    addDispatchRun("lint-dup", now - 3 * HOUR, { found: 0 });
    const feed = activityFeed(undefined, audit, db, { last: "24h" });
    expect(feed[0].message).toBe("4 issues found");
    expect(feed[1].message).toBe("1 issue found");
    expect(feed[2].message).toBe("0 issues found");
  });

  it("filters dispatch runs by the selected key like profiler runs", () => {
    const now = Date.now();
    addDispatchRun("lint-naming", now - HOUR);
    addDispatchRun("lint-dup", now - HOUR);
    const feed = activityFeed(undefined, audit, db, {
      last: "24h",
      rules: "lint:naming",
    });
    expect(feed.map((e) => e.key)).toEqual(["lint:naming"]);
  });
});

describe("listLogs", () => {
  it("filters by sinceMs and caps by limit, newest-first", () => {
    const now = Date.now();
    addLog("a", "old", now - 5 * HOUR);
    addLog("b", "mid", now - 2 * HOUR);
    addLog("c", "new", now - HOUR);
    expect(listLogs(audit).map((l) => l.message)).toEqual([
      "new",
      "mid",
      "old",
    ]);
    expect(
      listLogs(audit, { sinceMs: now - 3 * HOUR }).map((l) => l.message),
    ).toEqual(["new", "mid"]);
    expect(listLogs(audit, { limit: 1 }).map((l) => l.message)).toEqual([
      "new",
    ]);
  });
});
