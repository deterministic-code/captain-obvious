/**
 * The canonical stage list — the single source of truth for the stage taxonomy.
 * Each blocking client-side git hook has two stages: a **Claude-context** stage
 * (dispatched when git is invoked by Claude Code, `CLAUDECODE=1`) and a
 * **CLI-context** `git-`prefixed stage (a human running git in a terminal). The
 * installed hook script (core/lib/git-hooks.mjs) picks which to dispatch by
 * `CLAUDECODE`, so a repo lints Claude's commits while leaving human commits
 * ungated by default — the `git-*` stages start empty; opt human commits in
 * per-rule via the panel. `tool` fires from the Claude Code editor hooks, not
 * git — guard rules on PreToolUse (claudeGuard) and fix rules on PostToolUse
 * (toolFix); `server` marks a governance policy only GitHub can enforce. A
 * stage's `gitFlag` is the lint-mode flag its rules receive when a git hook
 * dispatches it — stages with no local git runner carry null. Ordered
 * earliest-first so a rule's `stages[0]` (the scalar the prebuilt panel reads)
 * is deterministic; each Claude stage precedes its CLI twin so the scalar shows
 * the Claude context.
 */
export const STAGES = [
  { slug: "pre-commit", name: "Pre-commit (Claude)", gitFlag: "--staged" },
  { slug: "git-pre-commit", name: "Pre-commit (CLI)", gitFlag: "--staged" },
  { slug: "commit-msg", name: "Commit-msg (Claude)", gitFlag: "--commit-msg" },
  { slug: "git-commit-msg", name: "Commit-msg (CLI)", gitFlag: "--commit-msg" },
  { slug: "pre-merge-commit", name: "Pre-merge-commit (Claude)", gitFlag: "--staged" },
  { slug: "git-pre-merge-commit", name: "Pre-merge-commit (CLI)", gitFlag: "--staged" },
  { slug: "pre-rebase", name: "Pre-rebase (Claude)", gitFlag: "--pre-rebase" },
  { slug: "git-pre-rebase", name: "Pre-rebase (CLI)", gitFlag: "--pre-rebase" },
  { slug: "pre-push", name: "Pre-push (Claude)", gitFlag: "--push" },
  { slug: "git-pre-push", name: "Pre-push (CLI)", gitFlag: "--push" },
  { slug: "tool", name: "Tool (Claude editor)", gitFlag: null },
  { slug: "stop", name: "Stop (Claude session)", gitFlag: null },
  { slug: "server", name: "Server (GitHub)", gitFlag: null },
] as const;

export type Stage = (typeof STAGES)[number]["slug"];

/** Stages with a local git runner (every git-hook stage; `tool`/`server` excluded). */
export type GitStage = Extract<
  (typeof STAGES)[number],
  { gitFlag: string }
>["slug"];

/** Local git stages mapped to the lint-mode flag their rules receive. */
export const GIT_STAGE_FLAG = Object.fromEntries(
  STAGES.flatMap((s) => (s.gitFlag ? [[s.slug, s.gitFlag]] : [])),
) as Record<GitStage, string>;

const STAGE_SLUGS = new Set<string>(STAGES.map((s) => s.slug));

/** Assert a raw string is a known stage slug (validates DB writes and CLI input). */
export function requireStage(value: string): Stage {
  if (!STAGE_SLUGS.has(value)) throw new Error(`unknown stage: ${value}`);
  return value as Stage;
}

/**
 * Canonical order index for a stage, for stable ordering of a rule's stage set.
 * Callers pass validated stages (rule_stages only holds requireStage'd slugs), so
 * an unknown slug — findIndex's -1 — can't occur here.
 */
export function stageOrder(stage: string): number {
  return STAGES.findIndex((s) => s.slug === stage);
}
