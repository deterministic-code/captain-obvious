/**
 * What each action-type binding means to the lint runner. A binding names one
 * `action_types` slug; this maps it to the three levers the dispatcher pulls:
 * whether to run the rule's deterministic fix first, whether to run the check,
 * and whether a failing check fails the git stage.
 *
 * The `fix*` variants run the rule's `script` fix (pre-commit only — a pre-push
 * fix can't reach the commits being pushed) and then: `fix` stops there, while
 * `fix_and_warn`/`fix_and_halt` re-run the check and report/block on leftovers.
 */
export interface ActionBehavior {
  /** Run the rule's deterministic `script` fix before checking (pre-commit only). */
  runsFix: boolean;
  /** Run the check — for the fix variants, after the fix — and print violations. */
  checks: boolean;
  /** Fail the git stage when the (post-fix) check reports violations. */
  blocks: boolean;
}

/** The binding a rule falls back to when it has no default (env-null) row. */
export const DEFAULT_ACTION = "halt";

export const ACTION_BEHAVIOR: Readonly<Record<string, ActionBehavior>> = {
  warn: { runsFix: false, checks: true, blocks: false },
  halt: { runsFix: false, checks: true, blocks: true },
  delay_halt: { runsFix: false, checks: true, blocks: true },
  fix: { runsFix: true, checks: false, blocks: false },
  fix_and_warn: { runsFix: true, checks: true, blocks: false },
  fix_and_halt: { runsFix: true, checks: true, blocks: true },
};

/** Action slugs that run the rule's deterministic fix — only offered for fixable rules. */
export const FIX_ACTIONS: readonly string[] = Object.keys(
  ACTION_BEHAVIOR,
).filter((slug) => ACTION_BEHAVIOR[slug].runsFix);

/**
 * The behavior for a binding slug. The `action_types` catalog is extensible
 * (CLI `configure-action --add`), so an unknown/custom slug is treated as a
 * plain blocking gate — the pre-existing default for anything that isn't `warn`.
 */
export function actionBehavior(slug: string): ActionBehavior {
  return ACTION_BEHAVIOR[slug] ?? ACTION_BEHAVIOR[DEFAULT_ACTION];
}
