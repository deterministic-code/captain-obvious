/**
 * The Control Panel server. Exposes the /api/* routes the prebuilt web/dist
 * bundle calls and serves that bundle as a single-page app. Uses only Node's
 * built-in http/fs — no web framework dependency.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb, resolveDbPath } from "../db/open.js";
import { openAuditDb, resolveAuditDbPath, useAuditLog } from "../db/audit.js";
import { ensureDefaultProject } from "../db/projects.js";
import {
  addActionType,
  createProject,
  getMeta,
  getMode,
  getStats,
  listProjectRules,
  listProjects,
  listRules,
  patchProjectRule,
  patchRule,
  seed,
  updateProject,
} from "./registry.js";
import { profilingMeta, profilingReport } from "./profiling.js";
import { activityFeed, activitySummary } from "./activity.js";
import { browse, readSource, runMeta, runRules, type RunRequest } from "./run.js";
import {
  aiApplyFix,
  aiProposeAllFixes,
  aiProposeFix,
  fixRule,
  planAllFixes,
  planFix,
  type AiApplyRequest,
  type FixRequest,
} from "./fix.js";
import { analyzeProject, analyzeStatus } from "./analyze.js";
import { PANEL_EXT } from "./panelExt.js";

// dist/server/serve.js -> repo root (matches open.ts's pkgRoot derivation).
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB_DIR = resolve(pkgRoot, "web", "dist");
// The external profiler writes to the monorepo root (.profile), a sibling of core/.
const PROFILE_DB =
  process.env.CAPTAIN_OBVIOUS_PROFILE_DB ??
  resolve(pkgRoot, "..", ".profile", "profile.db");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

interface ServeOptions {
  port?: number;
  host?: string;
  dbPath?: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Name for the default project (the repo the hook is installed in): the
 * install repo's package.json `name`, or its folder name when absent.
 */
function resolveDefaultProjectName(root: string): string {
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    if (pkg.name) return pkg.name;
  }
  return basename(root);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  // Resolve within WEB_DIR only; anything that escapes falls back to the SPA
  // entry so client-side routes still load index.html.
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(WEB_DIR, rel);
  if (!filePath.startsWith(WEB_DIR) || pathname === "/" || !existsSync(filePath)) {
    filePath = join(WEB_DIR, "index.html");
  }
  try {
    const ext = extname(filePath);
    // Inject the panel augmentation into the SPA entry. The bundle has no
    // source, so this serve-time graft is the only way to extend its UI; it
    // adds nothing the panel depends on, so it stays ignorable.
    if (ext === ".html") {
      const html = await readFile(filePath, "utf8");
      const grafted = html.replace(
        "</body>",
        '<script src="/panel-ext.js" defer></script></body>',
      );
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(grafted);
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}

/** Start the Control Panel server. Returns once it is listening. */
export function startServer(opts: ServeOptions = {}): Promise<void> {
  const port = opts.port ?? 4317;
  const host = opts.host ?? "127.0.0.1";
  const dbPath = resolveDbPath({ db: opts.dbPath });
  const db = openDb(dbPath);
  const auditDbPath = resolveAuditDbPath();
  const auditDb = openAuditDb(auditDbPath);
  useAuditLog(auditDb);
  const mode = getMode(dbPath, auditDbPath);
  const cwd = process.cwd();
  ensureDefaultProject(db, cwd, resolveDefaultProjectName(cwd));

  const server = createServer((req, res) => {
    handle(req, res, db, auditDb, mode).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendJson(res, 400, { error: message });
      else res.end();
    });
  });

  return new Promise((resolvePromise) => {
    server.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      process.stdout.write(
        `captain-obvious: control panel on ${url}\n` +
          `  mode:      ${mode.mode}\n` +
          `  registry:  ${dbPath}\n` +
          `  audit:     ${auditDbPath}\n` +
          `  profiling: ${PROFILE_DB}${existsSync(PROFILE_DB) ? "" : " (missing)"}\n`,
      );
      resolvePromise();
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  db: ReturnType<typeof openDb>,
  auditDb: ReturnType<typeof openAuditDb>,
  mode: ReturnType<typeof getMode>,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;
  const method = req.method ?? "GET";

  if (!pathname.startsWith("/api/")) {
    if (method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
    if (pathname === "/panel-ext.js") {
      // The injected panel script has a fixed URL and no content hash, so a
      // stale copy would stick in the browser's disk cache — force revalidation.
      res.writeHead(200, { "content-type": MIME[".js"], "cache-control": "no-cache" });
      res.end(PANEL_EXT);
      return;
    }
    return serveStatic(res, pathname);
  }

  // --- registry ---
  if (pathname === "/api/rules" && method === "GET") {
    return sendJson(res, 200, listRules(db));
  }
  if (pathname === "/api/meta" && method === "GET") {
    return sendJson(res, 200, getMeta(db));
  }
  if (pathname === "/api/mode" && method === "GET") {
    return sendJson(res, 200, mode);
  }
  if (pathname === "/api/stats" && method === "GET") {
    return sendJson(res, 200, getStats(db));
  }
  if (pathname.startsWith("/api/rules/") && method === "PATCH") {
    const slug = decodeURIComponent(pathname.slice("/api/rules/".length));
    const body = (await readBody(req)) as Parameters<typeof patchRule>[2];
    return sendJson(res, 200, patchRule(db, slug, body));
  }
  if (pathname === "/api/seed" && method === "POST") {
    return sendJson(res, 200, seed(db));
  }
  if (pathname === "/api/action-types" && method === "POST") {
    const body = (await readBody(req)) as Parameters<typeof addActionType>[1];
    return sendJson(res, 200, addActionType(db, body));
  }

  // --- projects (per-project rule config) ---
  if (pathname === "/api/projects" && method === "GET") {
    return sendJson(res, 200, listProjects(db));
  }
  if (pathname === "/api/projects" && method === "POST") {
    const body = (await readBody(req)) as Parameters<typeof createProject>[1];
    return sendJson(res, 200, createProject(db, body));
  }
  if (pathname.startsWith("/api/projects/")) {
    const rest = pathname.slice("/api/projects/".length);
    const ruleMatch = rest.match(/^([^/]+)\/rules\/(.+)$/);
    if (ruleMatch && method === "PATCH") {
      const id = Number(decodeURIComponent(ruleMatch[1]));
      const slug = decodeURIComponent(ruleMatch[2]);
      const body = (await readBody(req)) as Parameters<typeof patchProjectRule>[3];
      return sendJson(res, 200, patchProjectRule(db, id, slug, body));
    }
    if (rest.endsWith("/rules") && method === "GET") {
      const id = Number(decodeURIComponent(rest.slice(0, -"/rules".length)));
      return sendJson(res, 200, listProjectRules(db, id));
    }
    if (!rest.includes("/") && method === "PATCH") {
      const id = Number(decodeURIComponent(rest));
      const body = (await readBody(req)) as Parameters<typeof updateProject>[2];
      return sendJson(res, 200, updateProject(db, id, body));
    }
  }

  // --- run (execute rules against a folder) ---
  if (pathname === "/api/run/meta" && method === "GET") {
    return sendJson(res, 200, await runMeta());
  }
  if (pathname === "/api/run/browse" && method === "GET") {
    return sendJson(res, 200, await browse(url.searchParams.get("path") ?? undefined));
  }
  if (pathname === "/api/run/file" && method === "GET") {
    return sendJson(res, 200, await readSource(url.searchParams.get("path") ?? undefined));
  }
  if (pathname === "/api/run" && method === "POST") {
    const body = (await readBody(req)) as RunRequest;
    return sendJson(res, 200, await runRules(body));
  }

  // --- fix (apply a rule's remediation to violations the run surfaced) ---
  if (pathname === "/api/run/fix" && method === "POST") {
    const body = (await readBody(req)) as FixRequest;
    return sendJson(res, 200, await fixRule(db, auditDb, body));
  }
  if (pathname === "/api/run/fix/plan" && method === "POST") {
    const body = (await readBody(req)) as FixRequest;
    return sendJson(res, 200, await planFix(db, body));
  }
  if (pathname === "/api/run/fix/plan/all" && method === "POST") {
    const body = (await readBody(req)) as RunRequest;
    return sendJson(res, 200, await planAllFixes(db, body));
  }
  if (pathname === "/api/run/fix/ai" && method === "POST") {
    const body = (await readBody(req)) as FixRequest;
    return sendJson(res, 200, await aiProposeFix(db, body));
  }
  if (pathname === "/api/run/fix/ai/all" && method === "POST") {
    const body = (await readBody(req)) as RunRequest;
    return sendJson(res, 200, await aiProposeAllFixes(db, body));
  }
  if (pathname === "/api/run/fix/ai/apply" && method === "POST") {
    const body = (await readBody(req)) as AiApplyRequest;
    return sendJson(res, 200, await aiApplyFix(body));
  }

  // --- analyze (detect the project's languages; log the scan) ---
  if (pathname === "/api/analyze/status" && method === "GET") {
    return sendJson(res, 200, analyzeStatus());
  }
  if (pathname === "/api/analyze" && method === "POST") {
    const body = (await readBody(req)) as { path?: string };
    return sendJson(res, 200, await analyzeProject(body?.path));
  }

  // --- profiling (separate DB) ---
  if (pathname === "/api/profiling/meta" && method === "GET") {
    if (!existsSync(PROFILE_DB)) {
      return sendJson(res, 200, { dbPath: PROFILE_DB, count: 0 });
    }
    return sendJson(res, 200, profilingMeta(PROFILE_DB));
  }
  if (pathname === "/api/profiling/report" && method === "GET") {
    if (!existsSync(PROFILE_DB)) {
      return sendJson(res, 200, {
        groupCols: [],
        totals: { count: 0, total: 0, failures: 0 },
        groups: [],
      });
    }
    return sendJson(res, 200, profilingReport(PROFILE_DB, {
      last: url.searchParams.get("last") ?? undefined,
      group: url.searchParams.get("group") ?? undefined,
    }));
  }

  // --- activity (profiling "hooker" runs + dispatch runs + audit-log changes) ---
  if (pathname === "/api/activity/summary" && method === "GET") {
    return sendJson(res, 200, activitySummary(
      existsSync(PROFILE_DB) ? PROFILE_DB : undefined,
      auditDb,
      {
        last: url.searchParams.get("last") ?? undefined,
        rules: url.searchParams.get("rules") ?? undefined,
      },
    ));
  }
  if (pathname === "/api/activity/feed" && method === "GET") {
    const limit = url.searchParams.get("limit");
    return sendJson(res, 200, activityFeed(
      existsSync(PROFILE_DB) ? PROFILE_DB : undefined,
      auditDb,
      {
        last: url.searchParams.get("last") ?? undefined,
        rules: url.searchParams.get("rules") ?? undefined,
        limit: limit ? Number(limit) : undefined,
      },
    ));
  }

  return sendJson(res, 404, { error: `no route: ${method} ${pathname}` });
}
