/**
 * Remediation backend for the Run panel. A rule's `fixes` rows (kind `script` |
 * `inferred` | `output`) describe how to fix its violations; this module is what
 * finally *invokes* them:
 *   - `fixRule`      — a deterministic `script` fix (a node runner or a shell
 *                      command prefix), run over the target and applied in place.
 *   - `planFix`      — Tier A: build an instruction for the already-running Claude
 *                      Code agent to apply an `inferred` fix (no API key needed).
 *   - `aiProposeFix` — Tier B/C: ask a configured model (Anthropic, or any
 *                      OpenAI-compatible endpoint incl. a local one) for the
 *                      corrected file. Returns a proposal; never writes.
 *   - `aiApplyFix`   — write an accepted proposal after the user reviews the diff.
 * AI edits are non-deterministic, so they are always proposed-then-reviewed —
 * only `aiApplyFix` touches disk, and only for a file the user confirmed.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { recordHookRun } from "../db/audit.js";
import { getRuleFixes, type RuleAction } from "../db/fixes.js";
import type { Db } from "../db/open.js";
import { RULES } from "../rules/index.js";
import type { RuleMeta, Violation } from "../rules/types.js";
import { resolveRunTarget } from "./target.js";
import { runRuleOnFile } from "./run.js";
import { JS_TS_EXTS as LINTABLE_EXTS } from "../../lib/languages.mjs";

export interface FixRequest {
  slug?: string;
  path?: string;
}

function requireSlug(raw?: string): string {
  const slug = raw?.trim();
  if (!slug) throw new Error("slug is required");
  return slug;
}

/** The rule's registry metadata (name/description) for prompt context. Unknown slug throws. */
function ruleMeta(slug: string): RuleMeta {
  const rule = RULES.find((r) => r.meta.slug === slug);
  if (!rule) throw new Error(`unknown rule: ${slug}`);
  return rule.meta;
}

function requireAction(db: Db, slug: string, kind: RuleAction["kind"]): RuleAction {
  const action = getRuleFixes(db, slug).find((a) => a.kind === kind);
  if (!action) throw new Error(`rule has no ${kind} fix: ${slug}`);
  return action;
}

interface SpawnOutcome {
  ok: boolean;
  output: string;
}

/** Collect a child's merged stdout+stderr; resolve ok on a zero exit. */
function collect(child: ReturnType<typeof spawn>): Promise<SpawnOutcome> {
  return new Promise((resolvePromise) => {
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("error", (e) => resolvePromise({ ok: false, output: e.message }));
    child.on("close", (code) => resolvePromise({ ok: code === 0, output: out.trim() }));
  });
}

/**
 * A `script` action with `scriptPath`: the rule's own check runner in fix mode.
 * Convention (see lint-prettier): `node <runner> --fix <selector>`, where the
 * selector is the run's mode args (`--all`, or `--files <path>`).
 */
function runNodeFix(scriptPath: string, cwd: string, modeArgs: string[]): Promise<SpawnOutcome> {
  return collect(spawn(process.execPath, [scriptPath, "--fix", ...modeArgs], { cwd }));
}

/**
 * A `script` action with `scriptBody`: a command prefix (e.g. `npx prettier
 * --write`) that receives the target as a final argv element. Split on
 * whitespace and spawned without a shell, so a path with spaces stays one arg.
 */
function runShellFix(scriptBody: string, cwd: string, targetArg: string): Promise<SpawnOutcome> {
  const parts = scriptBody.trim().split(/\s+/);
  return collect(spawn(parts[0], [...parts.slice(1), targetArg], { cwd }));
}

export interface FixResult {
  slug: string;
  ok: boolean;
  output: string;
  error?: string;
}

/**
 * POST /api/run/fix — run a rule's deterministic `script` fix over `path` (a
 * folder scans its tree, a file just itself) and apply it in place. Logs the run
 * to the audit log so it shows in Activity, like a check.
 */
export async function fixRule(db: Db, auditDb: Db, body: FixRequest): Promise<FixResult> {
  const slug = requireSlug(body.slug);
  ruleMeta(slug);
  const action = requireAction(db, slug, "script");
  const { cwd, isDir, target, modeArgs } = await resolveRunTarget(body.path);
  const started = Date.now();
  const outcome = action.scriptPath
    ? await runNodeFix(action.scriptPath, cwd, modeArgs)
    : await runShellFix(action.scriptBody as string, cwd, isDir ? "." : target);
  recordHookRun(auditDb, {
    slug,
    stage: "fix",
    status: outcome.ok ? "success" : "failure",
    startedMs: started,
    durationMs: Date.now() - started,
  });
  return {
    slug,
    ok: outcome.ok,
    output: outcome.output,
    ...(outcome.ok ? {} : { error: outcome.output || "fix command failed" }),
  };
}

/**
 * The rule's metadata plus its `inferred` action if it declares one. An AI fix
 * works for any rule — the model just needs the rule intent and the violations —
 * so a missing `inferred` action is not an error; its `description` (extra fix
 * guidance) is simply absent from the prompt.
 */
async function fileFixContext(
  db: Db,
  slug: string,
): Promise<{ meta: RuleMeta; action: RuleAction | null }> {
  const meta = ruleMeta(slug);
  const action = getRuleFixes(db, slug).find((a) => a.kind === "inferred") ?? null;
  return { meta, action };
}

async function resolveFileTarget(rawPath?: string): Promise<string> {
  const { target, isDir } = await resolveRunTarget(rawPath);
  if (isDir) throw new Error("AI fix needs a single file, not a folder");
  return target;
}

async function fileViolations(slug: string, file: string): Promise<Violation[]> {
  const result = await runRuleOnFile(slug, file);
  if (!result.ok) throw new Error(result.error);
  return result.violations;
}

function describeViolations(violations: Violation[]): string {
  if (violations.length === 0) return "(no violations reported for this file)";
  return violations.map((v) => `- line ${v.line}:${v.col} [${v.kind}] ${v.detail}`).join("\n");
}

function joinLines(lines: (string | false)[]): string {
  return lines.filter((l): l is string => l !== false).join("\n");
}

/** Instruction for the running Claude Code agent to edit the file itself (it has tools). */
function buildAgentFixPrompt(
  meta: RuleMeta,
  action: RuleAction | null,
  absPath: string,
  violations: Violation[],
): string {
  return joinLines([
    `Fix the following ${meta.name} (${meta.slug}) lint violations in ${absPath}:`,
    "",
    describeViolations(violations),
    "",
    `Rule intent: ${meta.description}`,
    !!action?.description && `Fix guidance: ${action.description}`,
    "",
    "Edit the file in place so the rule passes. Keep the change minimal and behavior-preserving.",
  ]);
}

/** Instruction for a bare model (no tools) to return the corrected file content. */
function buildModelFixPrompt(
  meta: RuleMeta,
  action: RuleAction | null,
  relPath: string,
  source: string,
  violations: Violation[],
): string {
  return joinLines([
    `You are fixing ${meta.name} (${meta.slug}) lint violations in the file ${relPath}.`,
    `Rule intent: ${meta.description}`,
    !!action?.description && `Fix guidance: ${action.description}`,
    "",
    "Violations:",
    describeViolations(violations),
    "",
    "Current file content:",
    "```",
    source,
    "```",
    "",
    "Return the COMPLETE corrected file content only. No explanation, no markdown fences.",
  ]);
}

export interface FixPlan {
  slug: string;
  path: string;
  prompt: string;
  /** Where the prompt was also written, for an agent to pick up. */
  file: string;
}

/**
 * POST /api/run/fix/plan — Tier A. Build a fix instruction for an `inferred` rule
 * and hand it back (also written under `.claude/tmp/`) so the running Claude Code
 * agent can apply it. No model call, no API key.
 */
export async function planFix(db: Db, body: FixRequest): Promise<FixPlan> {
  const slug = requireSlug(body.slug);
  const { meta, action } = await fileFixContext(db, slug);
  const target = await resolveFileTarget(body.path);
  const prompt = buildAgentFixPrompt(meta, action, target, await fileViolations(slug, target));
  const file = resolve(process.cwd(), ".claude", "tmp", `co-fix-${slug}-${basename(target)}.md`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, prompt + "\n", "utf8");
  return { slug, path: target, prompt, file };
}

export interface FixModelConfig {
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string;
  baseUrl: string;
}

const DEFAULT_BASE_URL: Record<FixModelConfig["provider"], string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
};
const DEFAULT_MODEL: Record<FixModelConfig["provider"], string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
};

function isLocalHost(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(baseUrl);
}

/**
 * Resolve the fix model from CO_FIX_* env (falling back to the provider's own
 * key var). A local endpoint needs no key; a remote one without a key throws
 * early rather than firing an unauthenticated request.
 */
export function resolveFixModelConfig(env: NodeJS.ProcessEnv): FixModelConfig {
  const provider = env.CO_FIX_PROVIDER === "openai" ? "openai" : "anthropic";
  const baseUrl = env.CO_FIX_BASE_URL ?? DEFAULT_BASE_URL[provider];
  const model = env.CO_FIX_MODEL ?? DEFAULT_MODEL[provider];
  const apiKey =
    env.CO_FIX_API_KEY ??
    (provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY) ??
    "";
  if (!apiKey && !isLocalHost(baseUrl)) {
    throw new Error(
      `no API key for ${provider}: set CO_FIX_API_KEY (or point CO_FIX_BASE_URL at a local model)`,
    );
  }
  return { provider, model, apiKey, baseUrl };
}

async function postJson(url: string, headers: Record<string, string>, payload: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`${new URL(url).host} ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  return res.json();
}

async function callAnthropic(cfg: FixModelConfig, prompt: string): Promise<string> {
  const data = (await postJson(
    `${cfg.baseUrl}/v1/messages`,
    { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
    { model: cfg.model, max_tokens: 8192, messages: [{ role: "user", content: prompt }] },
  )) as { content: { type: string; text?: string }[] };
  return data.content.map((c) => c.text ?? "").join("");
}

async function callOpenAiCompat(cfg: FixModelConfig, prompt: string): Promise<string> {
  const headers: Record<string, string> = cfg.apiKey
    ? { authorization: `Bearer ${cfg.apiKey}` }
    : {};
  const data = (await postJson(`${cfg.baseUrl}/chat/completions`, headers, {
    model: cfg.model,
    messages: [{ role: "user", content: prompt }],
  })) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

/**
 * Strip an optional wrapping code fence; the corrected file is the remainder,
 * normalized to end in exactly one newline (a source file always should, and the
 * trim would otherwise drop the model's).
 */
function extractSource(reply: string): string {
  const trimmed = reply.trim();
  const fenced = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  const source = (fenced ? fenced[1] : trimmed).trim();
  if (!source) throw new Error("model returned empty output");
  return source + "\n";
}

export interface AiProposal {
  slug: string;
  path: string;
  provider: string;
  model: string;
  originalSource: string;
  newSource: string;
}

/**
 * POST /api/run/fix/ai — Tier B/C. Ask the configured model for the corrected
 * file and return it as a proposal. Does NOT write — the panel shows the diff and
 * only `aiApplyFix` commits it.
 */
export async function aiProposeFix(db: Db, body: FixRequest): Promise<AiProposal> {
  const slug = requireSlug(body.slug);
  const { meta, action } = await fileFixContext(db, slug);
  const target = await resolveFileTarget(body.path);
  const violations = await fileViolations(slug, target);
  const source = await readFile(target, "utf8");
  const cfg = resolveFixModelConfig(process.env);
  const prompt = buildModelFixPrompt(meta, action, relative(process.cwd(), target), source, violations);
  const reply =
    cfg.provider === "anthropic"
      ? await callAnthropic(cfg, prompt)
      : await callOpenAiCompat(cfg, prompt);
  return {
    slug,
    path: target,
    provider: cfg.provider,
    model: cfg.model,
    originalSource: source,
    newSource: extractSource(reply),
  };
}

export interface AiApplyRequest {
  path?: string;
  newSource?: string;
}

/**
 * POST /api/run/fix/ai/apply — write an accepted AI proposal. Restricted to
 * lintable files (the only ones the panel can produce a proposal for).
 */
export async function aiApplyFix(body: AiApplyRequest): Promise<{ path: string; ok: true }> {
  const path = body.path?.trim();
  if (!path) throw new Error("path is required");
  if (typeof body.newSource !== "string") throw new Error("newSource is required");
  const resolved = resolve(path);
  if (!LINTABLE_EXTS.has(extname(resolved))) {
    throw new Error(`not a writable file: ${resolved}`);
  }
  await writeFile(resolved, body.newSource, "utf8");
  return { path: resolved, ok: true };
}
