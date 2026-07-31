// The common interface every lint rule conforms to. It carries both the
// registry metadata that `seed-rules` writes to the DB and the execution surface
// (a uniform `run`, plus an optional pure `findViolations` for per-source rules).

import type { Stage } from "./stages.js";

/** When the rule runs. Canonical taxonomy + git flags live in stages.ts. */
export type { Stage };

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
  /** Every stage this rule runs at. A rule may enforce at more than one (e.g. a
   * path guard that fires both on `pre-commit` and from the `tool` guard). */
  stages: Stage[];
  /**
   * Remediation/output actions (rows in the `fixes` table). A rule may have
   * none (check only). On re-seed: `undefined` leaves existing actions
   * untouched; `[]` clears them.
   */
  actions?: RuleActionMeta[];
  /**
   * Keys of custom panel controls appended to this rule's settings dialog, on
   * top of the default controls (Enabled / Languages / Action / config). The
   * panel resolves each key against its control registry; unknown keys are
   * ignored. Omit for the default dialog only.
   */
  settingsControls?: string[];
}
