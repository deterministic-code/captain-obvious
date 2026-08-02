/**
 * The canonical stage list — the single source of truth for the stage taxonomy.
 * The git stages fire locally (pre-commit / pre-push); `tool` fires from the
 * Claude Code tool hooks, not from git — guard rules on PreToolUse (claudeGuard)
 * and fix rules on PostToolUse (toolFix); `server` marks a governance
 * policy only GitHub can enforce. A stage's `gitFlag` is the lint-mode flag its
 * rules receive when the git hook dispatches it — stages with no local git
 * runner carry null. Ordered earliest-first so a rule's `stages[0]` (the scalar
 * `stage` the prebuilt panel reads) is deterministic.
 */
export const STAGES = [
  { slug: "pre-commit", name: "Pre-commit", gitFlag: "--staged" },
  { slug: "pre-push", name: "Pre-push", gitFlag: "--push" },
  { slug: "tool", name: "Tool", gitFlag: null },
  { slug: "server", name: "Server", gitFlag: null },
] as const;

export type Stage = (typeof STAGES)[number]["slug"];

/** Stages with a local git runner (pre-commit / pre-push). */
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
