/**
 * Profiling API backed by the separate .profile/profile.db written by the lint
 * hooks ("via hooker" in the panel). This file is NOT the registry DB and must
 * not be opened through openDb (that would apply the registry schema); we open
 * it directly, read-only. Event timestamps are epoch MICROSECONDS; every
 * duration surfaced to the UI is converted to milliseconds.
 */
import Database from "better-sqlite3";

const US_PER_MS = 1000;
const WINDOW_SECONDS: Record<string, number> = {
  "1h": 3600,
  "24h": 86400,
  "7d": 604800,
};
const DEFAULT_COLS = ["tier", "hook", "command", "subcommand"];
const GROUPABLE = new Set(["tier", "hook", "command", "subcommand", "status"]);
const METRIC_COLS = ["count", "total", "avg", "p50", "p95", "failures"];

export interface ProfilingMeta {
  dbPath: string;
  count: number;
}

function open(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

/** GET /api/profiling/meta — where the data lives and how much of it there is. */
export function profilingMeta(dbPath: string): ProfilingMeta {
  const db = open(dbPath);
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM event").get() as {
      n: number;
    };
    return { dbPath, count: row.n };
  } finally {
    db.close();
  }
}

interface ReportRow {
  count: number;
  total: number;
  avg: number;
  p50: number;
  p95: number;
  failures: number;
  [groupCol: string]: string | number;
}
export interface ProfilingReport {
  groupCols: string[];
  totals: { count: number; total: number; failures: number };
  groups: ReportRow[];
}
export interface ReportQuery {
  last?: string;
  group?: string;
}

/** Nearest-rank percentile over an ascending-sorted array of numbers. */
function percentile(sorted: number[], p: number): number {
  // Unreachable: profilingReport only creates a bucket once an event pushes to it, so sorted is never empty.
  /* v8 ignore next */
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** GET /api/profiling/report — grouped timing rollups over the event table. */
export function profilingReport(
  dbPath: string,
  query: ReportQuery,
): ProfilingReport {
  // The panel's grouping dropdown can request columns the event table lacks
  // (e.g. "category"); echo the requested cols back as headers but only GROUP
  // BY the ones that actually exist. Missing cols render as "—".
  const requested = query.group
    ? query.group
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_COLS;
  const realCols = requested.filter((c) => GROUPABLE.has(c));

  const clauses: string[] = [];
  const params: number[] = [];
  const windowSeconds = query.last ? WINDOW_SECONDS[query.last] : undefined;
  if (windowSeconds) {
    const nowUs = Date.now() * US_PER_MS;
    clauses.push("start >= ?");
    params.push(nowUs - windowSeconds * 1_000_000);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const events = open(dbPath);
  let rows: {
    dur: number;
    failed: number;
    key: Record<string, string>;
  }[];
  try {
    const selectCols = realCols.map((c) => `"${c}" AS "${c}"`).join(", ");
    const prefix = selectCols ? `${selectCols}, ` : "";
    rows = events
      .prepare(
        `SELECT ${prefix}("end" - start) AS durUs, status FROM event ${where}`,
      )
      .all(...params)
      .map((raw) => {
        const r = raw as Record<string, unknown>;
        const key: Record<string, string> = {};
        for (const c of realCols) key[c] = String(r[c] ?? "—");
        return {
          dur: Number(r.durUs) / US_PER_MS,
          failed: r.status === "failure" ? 1 : 0,
          key,
        };
      });
  } finally {
    events.close();
  }

  // Bucket by the concrete grouping columns.
  const buckets = new Map<
    string,
    { key: Record<string, string>; durs: number[]; failures: number }
  >();
  for (const ev of rows) {
    const id = realCols.map((c) => ev.key[c]).join(" ");
    let b = buckets.get(id);
    if (!b) {
      b = { key: ev.key, durs: [], failures: 0 };
      buckets.set(id, b);
    }
    b.durs.push(ev.dur);
    b.failures += ev.failed;
  }

  const groups: ReportRow[] = [];
  let totalCount = 0;
  let totalTime = 0;
  let totalFailures = 0;
  for (const b of buckets.values()) {
    const durs = b.durs.slice().sort((a, c) => a - c);
    const sum = durs.reduce((a, c) => a + c, 0);
    const row: ReportRow = {
      count: durs.length,
      total: Math.round(sum),
      avg: Math.round(sum / durs.length),
      p50: Math.round(percentile(durs, 50)),
      p95: Math.round(percentile(durs, 95)),
      failures: b.failures,
    };
    // Fill every requested header (missing/non-real cols → "—").
    for (const c of requested) row[c] = b.key[c] ?? "—";
    groups.push(row);
    totalCount += durs.length;
    totalTime += sum;
    totalFailures += b.failures;
  }

  // Busiest first.
  groups.sort((a, b) => b.total - a.total);

  return {
    groupCols: requested,
    totals: {
      count: totalCount,
      total: Math.round(totalTime),
      failures: totalFailures,
    },
    groups,
  };
}

// Referenced for documentation of the fixed metric columns the UI always
// renders alongside the dynamic group columns.
export const REPORT_METRIC_COLS = METRIC_COLS;
