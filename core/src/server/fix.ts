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
import { logEvent, recordHookRun } from "../db/audit.js";
import { getRuleFixes, type RuleAction } from "../db/fixes.js";
import type { Db } from "../db/open.js";
import { RULES } from "../rules/index.js";
import { checkScriptPath } from "../rules/dispatch.js";
import type { RuleMeta, Violation } from "../rules/types.js";
import { repoRoot, resolveRunTarget } from "./target.js";
import { mapPool, runRuleOnFile, runRules, type RunRequest } from "./run.js";
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

function requireAction(
  db: Db,
  slug: string,
  kind: RuleAction["kind"],
): RuleAction {
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
    child.on("close", (code) =>
      resolvePromise({ ok: code === 0, output: out.trim() }),
    );
  });
}

/**
 * A `script` action with `scriptPath`: the rule's own check runner in fix mode.
 * Convention (see lint-prettier): `node <runner> --fix <selector>`, where the
 * selector is the run's mode args (`--all`, or `--files <path>`). The runner is
 * the loader-stamped absolute `checkScriptPath`, never the DB's repo-relative
 * `scriptPath` — `cwd` is the lint target, so a relative path would resolve
 * against the wrong tree (ENOENT for any file/subfolder target).
 */
function runNodeFix(
  runner: string,
  cwd: string,
  modeArgs: string[],
): Promise<SpawnOutcome> {
  return collect(
    spawn(process.execPath, [runner, "--fix", ...modeArgs], { cwd }),
  );
}

/**
 * A `script` action with `scriptBody`: a command prefix (e.g. `npx prettier
 * --write`) that receives the target as a final argv element. Split on
 * whitespace and spawned without a shell, so a path with spaces stays one arg.
 */
function runShellFix(
  scriptBody: string,
  cwd: string,
  targetArg: string,
): Promise<SpawnOutcome> {
  const parts = scriptBody.trim().split(/\s+/);
  return collect(spawn(parts[0], [...parts.slice(1), targetArg], { cwd }));
}

export interface FixResult {
  slug: string;
  ok: boolean;
  output: string;
  error?: string;
}

/** A one-line `+A/-B lines` summary of a rewrite, for the audit log. */
function summarizeLineDelta(oldSrc: string, newSrc: string): string {
  const count = (s: string) => (s === "" ? 0 : s.split("\n").length);
  const delta = count(newSrc) - count(oldSrc);
  const added = delta > 0 ? delta : 0;
  const removed = delta < 0 ? -delta : 0;
  return `+${added}/-${removed} lines`;
}

/** Count files modified in prettier/formatter output (lines without "(unchanged)"). */
function countModifiedFiles(output: string): number {
  const lines = output.split("\n");
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !line.startsWith("lint-") && !trimmed.startsWith("Re-stage")) {
      if (!trimmed.includes("(unchanged)")) count++;
    }
  }
  return count;
}

type ResolvedTarget = Awaited<ReturnType<typeof resolveRunTarget>>;

/**
 * Run one rule's `script` fix against an already-resolved target and log it to
 * the audit log (so it shows in Activity, like a check). The target is resolved
 * by the caller so a whole-run sweep resolves it once and reuses it per rule.
 */
async function runScriptFix(
  db: Db,
  auditDb: Db,
  slug: string,
  { cwd, isDir, target, modeArgs }: ResolvedTarget,
): Promise<FixResult> {
  const action = requireAction(db, slug, "script");
  const started = Date.now();
  const outcome = action.scriptPath
    ? await runNodeFix(checkScriptPath(slug), cwd, modeArgs)
    : await runShellFix(action.scriptBody as string, cwd, isDir ? "." : target);
  const fixed = outcome.ok ? countModifiedFiles(outcome.output) : null;
  recordHookRun(auditDb, {
    slug,
    stage: "fix",
    status: outcome.ok ? "success" : "failure",
    startedMs: started,
    durationMs: Date.now() - started,
    fixed,
  });
  logEvent(
    "fix.applied",
    `script fix ${slug} on ${relative(process.cwd(), target)} — ${outcome.ok ? "success" : "failed"}`,
  );
  return {
    slug,
    ok: outcome.ok,
    output: outcome.output,
    ...(outcome.ok ? {} : { error: outcome.output || "fix command failed" }),
  };
}

/**
 * POST /api/run/fix — run a rule's deterministic `script` fix over `path` (a
 * folder scans its tree, a file just itself) and apply it in place.
 */
export async function fixRule(
  db: Db,
  auditDb: Db,
  body: FixRequest,
): Promise<FixResult> {
  const slug = requireSlug(body.slug);
  ruleMeta(slug);
  return runScriptFix(db, auditDb, slug, await resolveRunTarget(body.path));
}

/** True when the rule declares a deterministic `script` fix (vs. AI-only). */
function hasScriptFix(db: Db, slug: string): boolean {
  return getRuleFixes(db, slug).some((a) => a.kind === "script");
}

export interface FixAllResult {
  results: FixResult[];
}

/**
 * POST /api/run/fix/all — the deterministic sweep. Run every requested rule that
 * declares a `script` fix over the run target, in place, no model. Fixes run
 * sequentially: several may rewrite the same files (e.g. prettier), so serial
 * execution avoids write races. A run with no script-fixable rules throws.
 */
export async function fixAllScripts(
  db: Db,
  auditDb: Db,
  body: RunRequest,
): Promise<FixAllResult> {
  const slugs = (body.slugs ?? []).filter((s) => hasScriptFix(db, s));
  if (slugs.length === 0) throw new Error("no deterministic fixes to run");
  const resolved = await resolveRunTarget(body.path);
  const results: FixResult[] = [];
  for (const slug of slugs)
    results.push(await runScriptFix(db, auditDb, slug, resolved));
  return { results };
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
  const action =
    getRuleFixes(db, slug).find((a) => a.kind === "inferred") ?? null;
  return { meta, action };
}

async function resolveFileTarget(rawPath?: string): Promise<string> {
  const { target, isDir } = await resolveRunTarget(rawPath);
  if (isDir) throw new Error("AI fix needs a single file, not a folder");
  return target;
}

async function fileViolations(
  slug: string,
  file: string,
): Promise<Violation[]> {
  const result = await runRuleOnFile(slug, file);
  if (!result.ok) throw new Error(result.error);
  return result.violations;
}

function describeViolations(violations: Violation[]): string {
  if (violations.length === 0) return "(no violations reported for this file)";
  return violations
    .map((v) => `- line ${v.line}:${v.col} [${v.kind}] ${v.detail}`)
    .join("\n");
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

/** One rule's violations in a single file, with the metadata a fix prompt needs. */
interface RuleFileGroup {
  slug: string;
  meta: RuleMeta;
  action: RuleAction | null;
  violations: Violation[];
}

/** The intent/guidance/violations block for one rule, shared by the agent and model prompts. */
function ruleFixSection(g: RuleFileGroup): (string | false)[] {
  return [
    `Rule ${g.meta.name} (${g.meta.slug}):`,
    `Rule intent: ${g.meta.description}`,
    !!g.action?.description && `Fix guidance: ${g.action.description}`,
    "Violations:",
    describeViolations(g.violations),
  ];
}

/**
 * Instruction for a bare model (no tools) to return one corrected file. A file
 * may violate several rules at once, so every rule touching it is folded into a
 * single prompt — one model call yields one coherent rewrite, not competing ones.
 */
function buildModelFixPrompt(
  relPath: string,
  source: string,
  rules: RuleFileGroup[],
): string {
  return joinLines([
    `You are fixing lint violations in the file ${relPath}.`,
    "",
    ...rules.flatMap((g) => [...ruleFixSection(g), ""]),
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
  const prompt = buildAgentFixPrompt(
    meta,
    action,
    target,
    await fileViolations(slug, target),
  );
  const file = resolve(
    process.cwd(),
    ".claude",
    "tmp",
    `co-fix-${slug}-${basename(target)}.md`,
  );
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

async function postJson(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(
      `${new URL(url).host} ${res.status}: ${(await res.text()).slice(0, 500)}`,
    );
  }
  return res.json();
}

async function callAnthropic(
  cfg: FixModelConfig,
  prompt: string,
): Promise<string> {
  const data = (await postJson(
    `${cfg.baseUrl}/v1/messages`,
    { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
    {
      model: cfg.model,
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    },
  )) as { content: { type: string; text?: string }[] };
  return data.content.map((c) => c.text ?? "").join("");
}

async function callOpenAiCompat(
  cfg: FixModelConfig,
  prompt: string,
): Promise<string> {
  const headers: Record<string, string> = cfg.apiKey
    ? { authorization: `Bearer ${cfg.apiKey}` }
    : {};
  const data = (await postJson(`${cfg.baseUrl}/chat/completions`, headers, {
    model: cfg.model,
    messages: [{ role: "user", content: prompt }],
  })) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

function callFixModel(cfg: FixModelConfig, prompt: string): Promise<string> {
  return cfg.provider === "anthropic"
    ? callAnthropic(cfg, prompt)
    : callOpenAiCompat(cfg, prompt);
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
export async function aiProposeFix(
  db: Db,
  body: FixRequest,
): Promise<AiProposal> {
  const slug = requireSlug(body.slug);
  const { meta, action } = await fileFixContext(db, slug);
  const target = await resolveFileTarget(body.path);
  const violations = await fileViolations(slug, target);
  const source = await readFile(target, "utf8");
  const cfg = resolveFixModelConfig(process.env);
  const prompt = buildModelFixPrompt(relative(process.cwd(), target), source, [
    { slug, meta, action, violations },
  ]);
  const reply = await callFixModel(cfg, prompt);
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
  /** Proposal context echoed back so the audit summary can name the model. */
  slug?: string;
  provider?: string;
  model?: string;
}

/**
 * POST /api/run/fix/ai/apply — write an accepted AI proposal and log a summary so
 * the inference-driven edit shows in Activity (unlike a script fix, nothing else
 * records it). The on-disk file is still the original here — the propose step never
 * wrote — so it doubles as the "before" for the line-delta summary.
 */
export async function aiApplyFix(
  body: AiApplyRequest,
): Promise<{ path: string; ok: true }> {
  const path = body.path?.trim();
  if (!path) throw new Error("path is required");
  if (typeof body.newSource !== "string")
    throw new Error("newSource is required");
  const resolved = resolve(path);
  if (!LINTABLE_EXTS.has(extname(resolved))) {
    throw new Error(`not a writable file: ${resolved}`);
  }
  const original = await readFile(resolved, "utf8");
  await writeFile(resolved, body.newSource, "utf8");
  const relPath = relative(process.cwd(), resolved);
  const model = body.model?.trim();
  logEvent(
    "fix.applied",
    `AI fix${model ? ` (${model})` : ""} on ${relPath} — ${summarizeLineDelta(original, body.newSource)}`,
  );
  return { path: resolved, ok: true };
}

/** A file and every rule that flagged a violation in it, for a whole-run fix. */
interface FileFixGroup {
  path: string;
  rules: RuleFileGroup[];
}

/**
 * Re-run the requested rules over the target and regroup every violation by the
 * file it lives in (then by rule), so a whole-run fix can act per file. Violation
 * paths are root-relative, resolved against the repo root like the per-file fix —
 * so "fix all" and a single "Fix with AI" always land on the same file. A rule
 * that failed to run is surfaced, not silently dropped.
 */
async function collectRunViolationsByFile(
  db: Db,
  body: RunRequest,
): Promise<FileFixGroup[]> {
  const results = await runRules(body);
  const root = await repoRoot();
  const byPath = new Map<string, FileFixGroup>();
  for (const r of results) {
    if (!r.ok) throw new Error(r.error);
    if (r.violations.length === 0) continue;
    const { meta, action } = await fileFixContext(db, r.slug);
    const perFile = new Map<string, Violation[]>();
    for (const v of r.violations) {
      if (!v.path)
        throw new Error(`${r.slug} reported a violation with no file path`);
      const abs = resolve(root, v.path);
      const vios = perFile.get(abs) ?? [];
      if (vios.length === 0) perFile.set(abs, vios);
      vios.push(v);
    }
    for (const [abs, violations] of perFile) {
      const group = byPath.get(abs) ?? { path: abs, rules: [] };
      if (group.rules.length === 0) byPath.set(abs, group);
      group.rules.push({ slug: r.slug, meta, action, violations });
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** One consolidated instruction for the running Claude Code agent to fix every violation in a run. */
function buildAllAgentFixPrompt(groups: FileFixGroup[]): string {
  const sections = groups.flatMap((g) => [
    `## ${g.path}`,
    "",
    ...g.rules.flatMap((rf) => [...ruleFixSection(rf), ""]),
  ]);
  return joinLines([
    "Fix all captain-obvious lint violations listed below.",
    "",
    "For each file, edit it in place so every listed rule passes. Keep each change minimal and behavior-preserving. Do not disable, ignore, or delete rules to silence a violation.",
    "When done, re-run `captain-obvious-lint` to confirm the violations are gone.",
    "",
    ...sections,
  ]);
}

export interface FixPlanAll {
  prompt: string;
  /** Where the prompt was also written, for an agent to pick up. */
  file: string;
}

/**
 * POST /api/run/fix/plan/all — build one prompt covering every violation in the
 * run and hand it back (also written under `.claude/tmp/`) for the running Claude
 * Code agent. No model call, no API key.
 */
export async function planAllFixes(
  db: Db,
  body: RunRequest,
): Promise<FixPlanAll> {
  const groups = await collectRunViolationsByFile(db, body);
  if (groups.length === 0) throw new Error("no violations to plan");
  const prompt = buildAllAgentFixPrompt(groups);
  const file = resolve(process.cwd(), ".claude", "tmp", "co-fix-all.md");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, prompt + "\n", "utf8");
  return { prompt, file };
}

export interface AiProposalAll {
  proposals: AiProposal[];
  /** Files that had violations but can't be AI-fixed (not a lintable source file). */
  skipped: { path: string; reason: string }[];
}

/** One model call per file: fold every rule that flagged it into a single rewrite proposal. */
async function proposeFileFix(
  cfg: FixModelConfig,
  g: FileFixGroup,
): Promise<AiProposal> {
  const source = await readFile(g.path, "utf8");
  const prompt = buildModelFixPrompt(
    relative(process.cwd(), g.path),
    source,
    g.rules,
  );
  const reply = await callFixModel(cfg, prompt);
  return {
    slug: g.rules.map((rf) => rf.slug).join(", "),
    path: g.path,
    provider: cfg.provider,
    model: cfg.model,
    originalSource: source,
    newSource: extractSource(reply),
  };
}

/**
 * POST /api/run/fix/ai/all — Tier B/C for a whole run. Ask the model for a
 * corrected version of every violated file (one call per file) and return them as
 * proposals; nothing is written until the user applies each via `aiApplyFix`.
 * Non-lintable files can't be written back, so they're reported as skipped.
 */
export async function aiProposeAllFixes(
  db: Db,
  body: RunRequest,
): Promise<AiProposalAll> {
  const groups = await collectRunViolationsByFile(db, body);
  if (groups.length === 0) throw new Error("no violations to fix");
  const cfg = resolveFixModelConfig(process.env);
  const skipped: AiProposalAll["skipped"] = [];
  const fixable: FileFixGroup[] = [];
  for (const g of groups) {
    if (LINTABLE_EXTS.has(extname(g.path))) fixable.push(g);
    else skipped.push({ path: g.path, reason: "not an AI-writable file" });
  }
  const proposals = await mapPool(fixable, 4, (g) => proposeFileFix(cfg, g));
  return { proposals, skipped };
}
