import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn((_cmd: string, _args: string[], cb: (e: unknown, r: unknown) => void) =>
    cb(null, { stdout: "true\n", stderr: "" }),
  ),
}));

import { spawn } from "node:child_process";
import { checkScriptPath } from "../../rules/dispatch.js";
import { listHookRuns, openAuditDb } from "../../db/audit.js";
import { setRuleFixes } from "../../db/fixes.js";
import { openDb, type Db } from "../../db/open.js";
import { addRule } from "../../db/rules.js";
import {
  aiApplyFix,
  aiProposeAllFixes,
  aiProposeFix,
  fixAllScripts,
  fixRule,
  planAllFixes,
  planFix,
  resolveFixModelConfig,
} from "../fix.js";

const spawnMock = vi.mocked(spawn);

interface ChildOpts {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  err?: Error;
}

function fakeChild(opts: ChildOpts): EventEmitter {
  const c = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (opts.err) return c.emit("error", opts.err);
    if (opts.stdout) c.stdout.emit("data", opts.stdout);
    if (opts.stderr) c.stderr.emit("data", opts.stderr);
    c.emit("close", opts.code ?? 0);
  });
  return c;
}

const jsonLine = (violations: unknown[]) => JSON.stringify({ violations }) + "\n";
const V = { path: "a.ts", line: 1, col: 3, kind: "snake_case", detail: "rename my_var" };

/** A stub Response with just the bits postJson/callModel read. */
function fetchResponse(opts: { ok: boolean; status?: number; json?: unknown; text?: string }) {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    json: async () => opts.json,
    text: async () => opts.text ?? "",
  } as unknown as Response;
}

let db: Db;
let auditDb: Db;
let dir: string;
let filePath: string;

beforeEach(() => {
  db = openDb(":memory:");
  auditDb = openAuditDb(":memory:");
  addRule(db, { slug: "lint-prettier", name: "Prettier" });
  addRule(db, { slug: "lint-naming", name: "Naming" });
  addRule(db, { slug: "lint-max-lines", name: "Max lines" });

  dir = mkdtempSync(join(tmpdir(), "co-fix-"));
  filePath = join(dir, "a.ts");
  writeFileSync(filePath, "const my_var = 1;\n");
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  spawnMock.mockImplementation(() => fakeChild({ stdout: jsonLine([V]), code: 0 }) as never);
});

afterEach(() => {
  db.close();
  auditDb.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  spawnMock.mockReset();
});

describe("fixRule — validation", () => {
  it("throws when slug is missing", async () => {
    await expect(fixRule(db, auditDb, {})).rejects.toThrow("slug is required");
    await expect(fixRule(db, auditDb, { slug: "  " })).rejects.toThrow("slug is required");
  });

  it("throws on an unknown rule before touching the db", async () => {
    await expect(fixRule(db, auditDb, { slug: "bogus", path: dir })).rejects.toThrow(
      "unknown rule: bogus",
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("throws when the rule has no script fix", async () => {
    setRuleFixes(db, "lint-max-lines", [{ kind: "output" }]);
    await expect(fixRule(db, auditDb, { slug: "lint-max-lines", path: dir })).rejects.toThrow(
      "rule has no script fix: lint-max-lines",
    );
  });
});

describe("fixRule — scriptBody (shell command prefix)", () => {
  beforeEach(() => {
    setRuleFixes(db, "lint-prettier", [{ kind: "script", scriptBody: "npx prettier --write" }]);
    spawnMock.mockImplementation(() => fakeChild({ stdout: "formatted\n", code: 0 }) as never);
  });

  it("appends '.' as the target for a folder run and records success", async () => {
    const res = await fixRule(db, auditDb, { slug: "lint-prettier", path: dir });
    expect(res).toEqual({ slug: "lint-prettier", ok: true, output: "formatted" });
    const [cmd, args, opts] = spawnMock.mock.calls[0] as [string, string[], { cwd: string }];
    expect(cmd).toBe("npx");
    expect(args).toEqual(["prettier", "--write", "."]);
    expect(opts.cwd).toBe(dir);
    const runs = listHookRuns(auditDb);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ slug: "lint-prettier", stage: "fix", status: "success" });
  });

  it("passes the file itself as the target for a file run", async () => {
    await fixRule(db, auditDb, { slug: "lint-prettier", path: filePath });
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toEqual(["prettier", "--write", filePath]);
  });
});

describe("fixAllScripts — deterministic sweep", () => {
  beforeEach(() => {
    setRuleFixes(db, "lint-prettier", [{ kind: "script", scriptBody: "prettier --write" }]);
    setRuleFixes(db, "lint-max-lines", [{ kind: "script", scriptBody: "eslint --fix" }]);
    setRuleFixes(db, "lint-naming", [{ kind: "inferred", description: "Rename." }]);
    spawnMock.mockImplementation(() => fakeChild({ stdout: "ok\n", code: 0 }) as never);
  });

  it("runs only the script-fixable rules, in request order, one result each", async () => {
    const { results } = await fixAllScripts(db, auditDb, {
      slugs: ["lint-prettier", "lint-naming", "lint-max-lines"],
      path: dir,
    });
    expect(results.map((r) => r.slug)).toEqual(["lint-prettier", "lint-max-lines"]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(spawnMock.mock.calls.map((c) => c[0])).toEqual(["prettier", "eslint"]);
    expect(listHookRuns(auditDb).map((r) => r.slug).sort()).toEqual([
      "lint-max-lines",
      "lint-prettier",
    ]);
  });

  it("throws before spawning when no requested rule has a deterministic fix", async () => {
    await expect(
      fixAllScripts(db, auditDb, { slugs: ["lint-naming"], path: dir }),
    ).rejects.toThrow("no deterministic fixes to run");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("throws on an empty or absent slug list", async () => {
    await expect(fixAllScripts(db, auditDb, { slugs: [], path: dir })).rejects.toThrow(
      "no deterministic fixes to run",
    );
    await expect(fixAllScripts(db, auditDb, { path: dir })).rejects.toThrow(
      "no deterministic fixes to run",
    );
  });

  it("surfaces a per-rule failure without aborting the remaining fixes", async () => {
    spawnMock
      .mockImplementationOnce(() => fakeChild({ stderr: "boom\n", code: 2 }) as never)
      .mockImplementationOnce(() => fakeChild({ stdout: "ok\n", code: 0 }) as never);
    const { results } = await fixAllScripts(db, auditDb, {
      slugs: ["lint-prettier", "lint-max-lines"],
      path: dir,
    });
    expect(results[0]).toMatchObject({ slug: "lint-prettier", ok: false, error: "boom" });
    expect(results[1]).toMatchObject({ slug: "lint-max-lines", ok: true });
  });
});

describe("fixRule — scriptPath (node runner in --fix mode)", () => {
  it("invokes the loader-stamped absolute runner, not the DB's repo-relative path", async () => {
    setRuleFixes(db, "lint-prettier", [
      { kind: "script", scriptPath: "rules/lint-prettier/check.mjs" },
    ]);
    spawnMock.mockImplementation(() => fakeChild({ code: 0 }) as never);
    await fixRule(db, auditDb, { slug: "lint-prettier", path: dir });
    const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([checkScriptPath("lint-prettier"), "--fix", "--all"]);
  });
});

describe("fixRule — failures", () => {
  beforeEach(() => {
    setRuleFixes(db, "lint-prettier", [{ kind: "script", scriptBody: "prettier --write" }]);
  });

  it("reports a non-zero exit as failed and records a failure run", async () => {
    spawnMock.mockImplementation(() => fakeChild({ stderr: "boom\n", code: 2 }) as never);
    const res = await fixRule(db, auditDb, { slug: "lint-prettier", path: dir });
    expect(res).toEqual({ slug: "lint-prettier", ok: false, output: "boom", error: "boom" });
    expect(listHookRuns(auditDb)[0]).toMatchObject({ status: "failure" });
  });

  it("falls back to a generic error when a failed command wrote nothing", async () => {
    spawnMock.mockImplementation(() => fakeChild({ code: 1 }) as never);
    const res = await fixRule(db, auditDb, { slug: "lint-prettier", path: dir });
    expect(res.error).toBe("fix command failed");
  });

  it("surfaces a spawn 'error' event as a failure", async () => {
    spawnMock.mockImplementation(() => fakeChild({ err: new Error("nope") }) as never);
    const res = await fixRule(db, auditDb, { slug: "lint-prettier", path: dir });
    expect(res).toEqual({ slug: "lint-prettier", ok: false, output: "nope", error: "nope" });
  });
});

describe("planFix — Tier A (delegate to Claude Code)", () => {
  beforeEach(() => {
    setRuleFixes(db, "lint-naming", [
      { kind: "inferred", description: "Rename to camelCase." },
    ]);
  });

  it("builds a prompt even for a rule with no inferred fix (AI fix is universal), omitting the guidance line", async () => {
    setRuleFixes(db, "lint-prettier", [{ kind: "script", scriptBody: "x" }]);
    const plan = await planFix(db, { slug: "lint-prettier", path: filePath });
    expect(plan.slug).toBe("lint-prettier");
    expect(plan.prompt).toContain("Rule intent:");
    expect(plan.prompt).not.toContain("Fix guidance:");
    expect(existsSync(plan.file)).toBe(true);
  });

  it("rejects a folder target", async () => {
    await expect(planFix(db, { slug: "lint-naming", path: dir })).rejects.toThrow(
      "AI fix needs a single file, not a folder",
    );
  });

  it("builds a prompt from fresh violations and writes it under .claude/tmp", async () => {
    const plan = await planFix(db, { slug: "lint-naming", path: filePath });
    expect(plan.slug).toBe("lint-naming");
    expect(plan.path).toBe(filePath);
    expect(plan.prompt).toContain("Naming conventions");
    expect(plan.prompt).toContain("line 1:3 [snake_case] rename my_var");
    expect(plan.prompt).toContain("Rename to camelCase.");
    expect(plan.file).toBe(join(dir, ".claude", "tmp", "co-fix-lint-naming-a.ts.md"));
    expect(existsSync(plan.file)).toBe(true);
    expect(readFileSync(plan.file, "utf8")).toContain("Naming conventions");
  });

  it("notes when a re-check finds no violations left", async () => {
    spawnMock.mockImplementation(() => fakeChild({ stdout: jsonLine([]), code: 0 }) as never);
    const plan = await planFix(db, { slug: "lint-naming", path: filePath });
    expect(plan.prompt).toContain("(no violations reported for this file)");
  });

  it("propagates a failing check instead of building a prompt", async () => {
    spawnMock.mockImplementation(() => fakeChild({ stderr: "check blew up\n", code: 2 }) as never);
    await expect(planFix(db, { slug: "lint-naming", path: filePath })).rejects.toThrow("check blew up");
  });
});

describe("aiProposeFix — Tier B/C (server-side model)", () => {
  beforeEach(() => {
    setRuleFixes(db, "lint-naming", [{ kind: "inferred", description: "Rename." }]);
  });

  it("calls Anthropic by default and returns a proposal (not applied)", async () => {
    vi.stubEnv("CO_FIX_API_KEY", "sk-test");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fetchResponse({ ok: true, json: { content: [{ type: "text", text: "const myVar = 1;\n" }] } }));
    vi.stubGlobal("fetch", fetchMock);

    const proposal = await aiProposeFix(db, { slug: "lint-naming", path: filePath });
    expect(proposal).toMatchObject({
      slug: "lint-naming",
      path: filePath,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      originalSource: "const my_var = 1;\n",
      newSource: "const myVar = 1;\n",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-test");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    // The file on disk is untouched — proposals are review-then-apply.
    expect(readFileSync(filePath, "utf8")).toBe("const my_var = 1;\n");
  });

  it("proposes a fix for a rule with no inferred action, omitting the guidance line", async () => {
    vi.stubEnv("CO_FIX_API_KEY", "sk-test");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fetchResponse({ ok: true, json: { content: [{ type: "text", text: "const myVar = 1;\n" }] } }));
    vi.stubGlobal("fetch", fetchMock);

    const proposal = await aiProposeFix(db, { slug: "lint-max-lines", path: filePath });
    expect(proposal.slug).toBe("lint-max-lines");
    expect(proposal.newSource).toBe("const myVar = 1;\n");
    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(prompt).toContain("Rule intent:");
    expect(prompt).not.toContain("Fix guidance:");
  });

  it("calls an OpenAI-compatible endpoint when configured", async () => {
    vi.stubEnv("CO_FIX_PROVIDER", "openai");
    vi.stubEnv("CO_FIX_API_KEY", "sk-oai");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fetchResponse({ ok: true, json: { choices: [{ message: { content: "fixed" } }] } }));
    vi.stubGlobal("fetch", fetchMock);

    const proposal = await aiProposeFix(db, { slug: "lint-naming", path: filePath });
    expect(proposal.provider).toBe("openai");
    expect(proposal.newSource).toBe("fixed\n");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer sk-oai");
  });

  it("omits the auth header for a keyless local endpoint", async () => {
    vi.stubEnv("CO_FIX_PROVIDER", "openai");
    vi.stubEnv("CO_FIX_BASE_URL", "http://localhost:11434/v1");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fetchResponse({ ok: true, json: { choices: [{ message: { content: "local fix" } }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const proposal = await aiProposeFix(db, { slug: "lint-naming", path: filePath });
    expect(proposal.newSource).toBe("local fix\n");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init.headers.authorization).toBeUndefined();
  });

  it("concatenates only the text blocks of an Anthropic reply", async () => {
    vi.stubEnv("CO_FIX_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fetchResponse({ ok: true, json: { content: [{ type: "thinking" }, { type: "text", text: "const myVar = 1;\n" }] } }),
      ),
    );
    const proposal = await aiProposeFix(db, { slug: "lint-naming", path: filePath });
    expect(proposal.newSource).toBe("const myVar = 1;\n");
  });

  it("strips a wrapping code fence from the model reply", async () => {
    vi.stubEnv("CO_FIX_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fetchResponse({ ok: true, json: { content: [{ type: "text", text: "```ts\nconst myVar = 1;\n```" }] } }),
      ),
    );
    const proposal = await aiProposeFix(db, { slug: "lint-naming", path: filePath });
    expect(proposal.newSource).toBe("const myVar = 1;\n");
  });

  it("throws when the model returns empty output", async () => {
    vi.stubEnv("CO_FIX_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fetchResponse({ ok: true, json: { content: [{ type: "text", text: "   " }] } })),
    );
    await expect(aiProposeFix(db, { slug: "lint-naming", path: filePath })).rejects.toThrow(
      "model returned empty output",
    );
  });

  it("surfaces a non-2xx model response with its status", async () => {
    vi.stubEnv("CO_FIX_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fetchResponse({ ok: false, status: 429, text: "rate limited" })),
    );
    await expect(aiProposeFix(db, { slug: "lint-naming", path: filePath })).rejects.toThrow(/429/);
  });
});

describe("resolveFixModelConfig", () => {
  it("defaults to Anthropic and requires a key for a remote endpoint", () => {
    expect(() => resolveFixModelConfig({})).toThrow(/no API key for anthropic/);
  });

  it("reads CO_FIX_API_KEY and the provider defaults", () => {
    const cfg = resolveFixModelConfig({ CO_FIX_API_KEY: "k" });
    expect(cfg).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "k",
      baseUrl: "https://api.anthropic.com",
    });
  });

  it("falls back to the provider's own key var", () => {
    expect(resolveFixModelConfig({ ANTHROPIC_API_KEY: "a" }).apiKey).toBe("a");
    const oai = resolveFixModelConfig({ CO_FIX_PROVIDER: "openai", OPENAI_API_KEY: "o" });
    expect(oai).toMatchObject({ provider: "openai", model: "gpt-4o", apiKey: "o", baseUrl: "https://api.openai.com/v1" });
  });

  it("allows a keyless local endpoint and honors overrides", () => {
    const local = resolveFixModelConfig({ CO_FIX_PROVIDER: "openai", CO_FIX_BASE_URL: "http://localhost:11434/v1" });
    expect(local.apiKey).toBe("");
    expect(local.baseUrl).toBe("http://localhost:11434/v1");
    const ipv6 = resolveFixModelConfig({ CO_FIX_BASE_URL: "http://[::1]:8080" });
    expect(ipv6.apiKey).toBe("");
    const overridden = resolveFixModelConfig({ CO_FIX_API_KEY: "k", CO_FIX_MODEL: "custom", CO_FIX_BASE_URL: "https://proxy.internal" });
    expect(overridden).toMatchObject({ model: "custom", baseUrl: "https://proxy.internal" });
  });
});

describe("aiApplyFix", () => {
  it("throws when path is missing", async () => {
    await expect(aiApplyFix({ newSource: "x" })).rejects.toThrow("path is required");
  });

  it("throws when newSource is not a string", async () => {
    await expect(aiApplyFix({ path: filePath })).rejects.toThrow("newSource is required");
  });

  it("refuses a non-lintable file", async () => {
    const md = join(dir, "notes.md");
    writeFileSync(md, "x");
    await expect(aiApplyFix({ path: md, newSource: "y" })).rejects.toThrow(/not a writable file/);
  });

  it("writes the accepted source and returns the resolved path", async () => {
    const res = await aiApplyFix({ path: filePath, newSource: "const myVar = 1;\n" });
    expect(res).toEqual({ path: filePath, ok: true });
    expect(readFileSync(filePath, "utf8")).toBe("const myVar = 1;\n");
  });
});

// Dispatch a violation set per rule, keyed by the slug in the spawned check path.
function spawnBySlug(bySlug: Record<string, unknown[]>): void {
  spawnMock.mockImplementation(((_exec: string, args: string[]) => {
    const script = args[0];
    const slug = Object.keys(bySlug).find((s) => script.includes(s));
    return fakeChild({ stdout: jsonLine(slug ? bySlug[slug] : []), code: 0 });
  }) as never);
}

const vio = (path: string, detail: string) => ({ path, line: 1, col: 1, kind: "k", detail });

describe("planAllFixes — one plan for the whole run", () => {
  it("groups every violation by file then rule and writes .claude/tmp/co-fix-all.md", async () => {
    setRuleFixes(db, "lint-naming", [{ kind: "inferred", description: "Rename to camelCase." }]);
    const fileB = join(dir, "b.ts");
    spawnBySlug({
      "lint-naming": [vio(filePath, "rename my_var")],
      "lint-max-lines": [vio(filePath, "file too long"), vio(fileB, "way too long")],
    });

    const plan = await planAllFixes(db, { slugs: ["lint-naming", "lint-max-lines"], path: dir });
    expect(plan.file).toBe(join(dir, ".claude", "tmp", "co-fix-all.md"));
    expect(existsSync(plan.file)).toBe(true);
    // a.ts holds both rules; b.ts only the second — grouped and file-sorted.
    expect(plan.prompt.indexOf("## " + filePath)).toBeLessThan(plan.prompt.indexOf("## " + fileB));
    expect(plan.prompt).toContain("(lint-naming):");
    expect(plan.prompt).toContain("(lint-max-lines):");
    expect(plan.prompt).toContain("Rename to camelCase.");
    expect(plan.prompt).toContain("rename my_var");
    expect(plan.prompt).toContain("way too long");
    expect(plan.prompt).toContain("re-run `captain-obvious-lint`");
  });

  it("throws when the run surfaced no violations", async () => {
    spawnBySlug({});
    await expect(planAllFixes(db, { slugs: ["lint-naming"], path: dir })).rejects.toThrow(
      "no violations to plan",
    );
  });

  it("surfaces a rule that failed to run instead of building a plan", async () => {
    spawnMock.mockImplementation(() => fakeChild({ stderr: "check blew up\n", code: 2 }) as never);
    await expect(planAllFixes(db, { slugs: ["lint-naming"], path: dir })).rejects.toThrow(
      "check blew up",
    );
  });

  it("surfaces a violation with no file path rather than fixing a phantom file", async () => {
    spawnBySlug({ "lint-naming": [{ line: 1, col: 1, kind: "k", detail: "pathless" }] });
    await expect(planAllFixes(db, { slugs: ["lint-naming"], path: dir })).rejects.toThrow(
      "lint-naming reported a violation with no file path",
    );
  });
});

describe("aiProposeAllFixes — model proposals for the whole run", () => {
  beforeEach(() => {
    setRuleFixes(db, "lint-naming", [{ kind: "inferred", description: "Rename." }]);
    writeFileSync(join(dir, "b.ts"), "const bad_name = 2;\n");
  });

  function stubModel(text: string) {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fetchResponse({ ok: true, json: { content: [{ type: "text", text }] } }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("returns one proposal per lintable file, folding every rule for a file into its prompt", async () => {
    vi.stubEnv("CO_FIX_API_KEY", "sk-test");
    const fileB = join(dir, "b.ts");
    spawnBySlug({
      "lint-naming": [vio(filePath, "rename my_var")],
      "lint-max-lines": [vio(filePath, "too long"), vio(fileB, "too long")],
    });
    const fetchMock = stubModel("fixed\n");

    const { proposals, skipped } = await aiProposeAllFixes(db, {
      slugs: ["lint-naming", "lint-max-lines"],
      path: dir,
    });
    expect(skipped).toEqual([]);
    expect(proposals.map((p) => p.path)).toEqual([filePath, fileB]);
    expect(proposals[0]).toMatchObject({ slug: "lint-naming, lint-max-lines", newSource: "fixed\n" });
    expect(proposals[1]).toMatchObject({ slug: "lint-max-lines", newSource: "fixed\n" });
    const prompts = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).messages[0].content);
    const aPrompt = prompts.find((p) => p.includes("file a.ts"));
    expect(aPrompt).toContain("(lint-naming):");
    expect(aPrompt).toContain("(lint-max-lines):");
    // Nothing written — proposals are review-then-apply.
    expect(readFileSync(filePath, "utf8")).toBe("const my_var = 1;\n");
  });

  it("skips a non-lintable file rather than proposing a fix for it", async () => {
    vi.stubEnv("CO_FIX_API_KEY", "sk-test");
    const md = join(dir, "notes.md");
    spawnBySlug({ "lint-naming": [vio(md, "bad")] });
    stubModel("fixed\n");

    const { proposals, skipped } = await aiProposeAllFixes(db, { slugs: ["lint-naming"], path: dir });
    expect(proposals).toEqual([]);
    expect(skipped).toEqual([{ path: md, reason: "not an AI-writable file" }]);
  });

  it("throws when there is no key for a remote endpoint", async () => {
    spawnBySlug({ "lint-naming": [vio(filePath, "rename")] });
    await expect(aiProposeAllFixes(db, { slugs: ["lint-naming"], path: dir })).rejects.toThrow(
      /no API key for anthropic/,
    );
  });

  it("throws when the run surfaced no violations", async () => {
    vi.stubEnv("CO_FIX_API_KEY", "sk-test");
    spawnBySlug({});
    await expect(aiProposeAllFixes(db, { slugs: ["lint-naming"], path: dir })).rejects.toThrow(
      "no violations to fix",
    );
  });
});
