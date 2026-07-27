/**
 * The Control Panel server. Exposes the /api/* routes the prebuilt web/dist
 * bundle calls and serves that bundle as a single-page app. Uses only Node's
 * built-in http/fs — no web framework dependency.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb, resolveDbPath } from "../db/open.js";
import {
  addActionType,
  getMeta,
  getStats,
  listRules,
  patchRule,
  seed,
} from "./registry.js";
import { profilingMeta, profilingReport } from "./profiling.js";

// dist/server/serve.js -> repo root (matches open.ts's pkgRoot derivation).
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB_DIR = resolve(pkgRoot, "web", "dist");
const PROFILE_DB =
  process.env.CAPTAIN_OBVIOUS_PROFILE_DB ??
  resolve(pkgRoot, ".profile", "profile.db");

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
    const data = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
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

  const server = createServer((req, res) => {
    handle(req, res, db).catch((err) => {
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
          `  registry:  ${dbPath}\n` +
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
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;
  const method = req.method ?? "GET";

  if (!pathname.startsWith("/api/")) {
    if (method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
    return serveStatic(res, pathname);
  }

  // --- registry ---
  if (pathname === "/api/rules" && method === "GET") {
    return sendJson(res, 200, listRules(db));
  }
  if (pathname === "/api/meta" && method === "GET") {
    return sendJson(res, 200, getMeta(db));
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

  return sendJson(res, 404, { error: `no route: ${method} ${pathname}` });
}
