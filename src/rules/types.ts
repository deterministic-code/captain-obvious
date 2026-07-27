// The common interface every lint rule conforms to. It carries both the
// registry metadata that `seed-rules` writes to the DB and the execution surface
// (a uniform `run`, plus an optional pure `findViolations` for per-source rules).

/** Languages the rules police today. JS/TS family only; other dialects later. */
export type Language = "typescript" | "javascript";

/** CLI modes a rule's runner understands (a subset per rule). */
export type LintMode = "staged" | "all" | "files" | "push" | "warn";

export type RuleCategory =
  | "duplication"
  | "solid"
  | "size"
  | "complexity"
  | "naming"
  | "comments"
  | "error-handling"
  | "performance"
  | "api-stability"
  | "dead-code"
  | "testing"
  | "formatting"
  | "governance";

/**
 * When the rule runs. The git stages fire locally (pre-commit / pre-push);
 * `server` marks a governance policy that only GitHub can enforce (branch
 * protection / rulesets) and therefore has no local runner.
 */
export type Stage = "pre-commit" | "pre-push" | "server";

/** Normalized violation shape, identical across every rule (lint-shared.mjs). */
export interface Violation {
  line: number;
  col: number;
  kind: string;
  detail: string;
  path?: string;
}

/**
 * An action a rule offers beyond the check itself. 'script' runs a deterministic
 * fix (e.g. prettier --write); 'inferred' delegates the fix to the model;
 * 'output' just reports to the user. Mirrors the db `FixKind` union (kept inline
 * so the rule layer stays decoupled from the db layer).
 */
export interface RuleActionMeta {
  kind: "inferred" | "script" | "output";
  /** For 'script' actions: the hook/script that applies the fix. */
  scriptPath?: string;
  description?: string;
}

/** DB-facing metadata — the source that `seed-rules` writes into the registry. */
export interface RuleMeta {
  slug: string;
  name: string;
  /** The rule's primary category (stored on rules.category; drives panel grouping/stats). */
  category: RuleCategory;
  /**
   * Additional categories beyond the primary. The full set written to
   * `rule_categories` is the primary plus these, de-duplicated. Omit for a
   * single-category rule.
   */
  categories?: RuleCategory[];
  description: string;
  languages: Language[];
  /** Thresholds etc.; serialized to rules.config_json. null when the rule has none. */
  config: Record<string, unknown> | null;
  ratchetable: boolean;
  modes: LintMode[];
  stage: Stage;
  /**
   * Remediation/output actions (rows in the `fixes` table). A rule may have
   * none (check only). On re-seed: `undefined` leaves existing actions
   * untouched; `[]` clears them.
   */
  actions?: RuleActionMeta[];
}

/** The common wrapper: metadata + execution. */
export interface LintRule {
  meta: RuleMeta;
  /** Run the underlying hook with raw argv (delegates to the .mjs `main`). */
  run(argv: string[]): Promise<void>;
  /** Per-source scan, where the rule exposes one. */
  findViolations?(src: string): Violation[] | Promise<Violation[]>;
}
