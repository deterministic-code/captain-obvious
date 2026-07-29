/**
 * Activity API. Unlike the registry, this reads two external, global sinks — the
 * hook profiling DB (.profile/profile.db, "hooker") for rule/script runs, and the
 * audit-log DB for config changes — to answer "what has this project been doing".
 * The profile DB is opened directly read-only (never through openDb, which would
 * impose the registry schema), mirroring profiling.ts. Event timestamps there are
 * epoch MICROSECONDS; everything surfaced to the UI is epoch milliseconds.
 */
import Database from "better-sqlite3";
import { listHookRuns, listLogs } from "../db/audit.js";
import type { Db } from "../db/open.js";

const US_PER_MS = 1000;
const BUCKETS = 24;
const DEFAULT_LIMIT = 200;
const DEFAULT_WINDOW = "7d";
const WINDOW_SECONDS: Record<string, number> = {
  "1h": 3600,
  "24h": 86400,
  "7d": 604800,
  "30d": 2592000,
};

/**
 * A rule row in the panel is keyed by slug (`lint-naming`); a profiling event is
 * keyed by the script it ran (`lint:naming`). The mapping is a best-effort prefix
 * swap — profiling carries no rule identity, so `lint-dup-fn` maps to `lint:dup-fn`
 * even when the repo only runs a coarser `lint:dup` script.
 */
export function slugToKey(slug: string): string {
  return slug.startsWith("lint-") ? `lint:${slug.slice("lint-".length)}` : slug;
}
export function keyToSlug(key: string): string {
  return key.startsWith("lint:") ? `lint-${key.slice("lint:".length)}` : key;
}

function windowSeconds(last?: string): number {
  return WINDOW_SECONDS[last ?? DEFAULT_WINDOW] ?? WINDOW_SECONDS[DEFAULT_WINDOW];
}

function parseRules(rules?: string): Set<string> {
  return new Set(
    (rules ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function openProfile(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

interface HookRun {
  key: string;
  startMs: number;
  failed: boolean;
  detail: string;
}

/** Window-filtered profiling rows, normalised to activity keys + ms. */
function readHookRuns(dbPath: string, sinceUs: number): HookRun[] {
  const db = openProfile(dbPath);
  try {
    return db
      .prepare(
        'SELECT command, subcommand, status, start FROM event WHERE start >= ? ORDER BY start DESC',
      )
      .all(sinceUs)
      .map((raw) => {
        const r = raw as {
          command: string;
          subcommand: string | null;
          status: string | null;
          start: number;
        };
        const key = (r.subcommand && String(r.subcommand)) || String(r.command);
        const detail = r.subcommand ? `${r.command} ${r.subcommand}` : String(r.command);
        return {
          key,
          startMs: Number(r.start) / US_PER_MS,
          failed: r.status === "failure",
          detail,
        };
      });
  } finally {
    db.close();
  }
}

/**
 * The git-hook dispatcher's own runs (audit DB), normalised to the same HookRun
 * shape as the profiler's. A rule slug maps to its activity key so a dispatch run
 * of `lint-naming` lines up with the same `lint:naming` bucket the profiler uses.
 * Started times are already epoch ms here — no microsecond conversion.
 */
function readDispatchRuns(auditDb: Db, sinceMs: number): HookRun[] {
  return listHookRuns(auditDb, { sinceMs }).map((r) => ({
    key: slugToKey(r.slug),
    startMs: r.started,
    failed: r.status === "failure",
    detail: `${r.stage} ${r.slug}`,
  }));
}

export interface ActivityTop {
  key: string;
  runs: number;
  failures: number;
}
export interface ActivityBucket {
  t: number;
  runs: number;
  failures: number;
}
export interface ActivitySummary {
  keys: string[];
  top: ActivityTop[];
  series: { bucketMs: number; buckets: ActivityBucket[] };
}
export interface ActivityQuery {
  last?: string;
  rules?: string;
}

/**
 * GET /api/activity/summary — top rules by run count + a bucketed timeline, both
 * scoped to the optional `rules` filter. `keys` lists every activity key in the
 * window (unfiltered) so the panel's multiselect can offer them all. Merges the
 * external profiler's runs (when its DB is present) with the dispatcher's own.
 */
export function activitySummary(
  dbPath: string | undefined,
  auditDb: Db,
  query: ActivityQuery,
): ActivitySummary {
  const secs = windowSeconds(query.last);
  const nowMs = Date.now();
  const startMs = nowMs - secs * 1000;
  const runs = [
    ...(dbPath ? readHookRuns(dbPath, startMs * US_PER_MS) : []),
    ...readDispatchRuns(auditDb, startMs),
  ];

  const keys = [...new Set(runs.map((r) => r.key))].sort();

  const selected = parseRules(query.rules);
  const scoped = selected.size ? runs.filter((r) => selected.has(r.key)) : runs;

  const byKey = new Map<string, ActivityTop>();
  for (const r of scoped) {
    let t = byKey.get(r.key);
    if (!t) {
      t = { key: r.key, runs: 0, failures: 0 };
      byKey.set(r.key, t);
    }
    t.runs += 1;
    if (r.failed) t.failures += 1;
  }
  const top = [...byKey.values()].sort((a, b) => b.runs - a.runs).slice(0, 10);

  const bucketMs = (secs * 1000) / BUCKETS;
  const buckets: ActivityBucket[] = Array.from({ length: BUCKETS }, (_, i) => ({
    t: Math.round(startMs + i * bucketMs),
    runs: 0,
    failures: 0,
  }));
  for (const r of scoped) {
    const idx = Math.min(
      BUCKETS - 1,
      Math.max(0, Math.floor((r.startMs - startMs) / bucketMs)),
    );
    buckets[idx].runs += 1;
    if (r.failed) buckets[idx].failures += 1;
  }

  return { keys, top, series: { bucketMs: Math.round(bucketMs), buckets } };
}

export interface ActivityEvent {
  timeMs: number;
  source: "hook" | "log";
  key: string;
  status?: string;
  detail: string;
}
export interface FeedQuery extends ActivityQuery {
  limit?: number;
}

/**
 * GET /api/activity/feed — newest-first merge of hook runs (from profiling) and
 * config changes (from the audit log). With a `rules` filter, hook rows keep only
 * the selected keys and log rows keep only messages that name a selected rule.
 * `dbPath` is undefined when the profile DB is absent — the log stream still flows.
 */
export function activityFeed(
  dbPath: string | undefined,
  auditDb: Db,
  query: FeedQuery,
): ActivityEvent[] {
  const secs = windowSeconds(query.last);
  const startMs = Date.now() - secs * 1000;
  const limit = query.limit ?? DEFAULT_LIMIT;
  const selected = parseRules(query.rules);

  const events: ActivityEvent[] = [];

  const hookRuns = [
    ...(dbPath ? readHookRuns(dbPath, startMs * US_PER_MS) : []),
    ...readDispatchRuns(auditDb, startMs),
  ];
  for (const r of hookRuns) {
    if (selected.size && !selected.has(r.key)) continue;
    events.push({
      timeMs: r.startMs,
      source: "hook",
      key: r.key,
      status: r.failed ? "failure" : "success",
      detail: r.detail,
    });
  }

  const selectedSlugs = [...selected].map(keyToSlug);
  for (const row of listLogs(auditDb, { sinceMs: startMs, limit })) {
    if (selected.size && !selectedSlugs.some((s) => row.message.includes(s))) continue;
    events.push({
      timeMs: Date.parse(`${row.created.replace(" ", "T")}Z`),
      source: "log",
      key: row.logType,
      detail: row.message,
    });
  }

  events.sort((a, b) => b.timeMs - a.timeMs);
  return events.slice(0, limit);
}
