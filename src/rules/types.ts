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
  | "testing";

/** Git stage the rule runs at today (metadata for future hook-link seeding). */
export type Stage = "pre-commit" | "pre-push";

/** Normalized violation shape, identical across every rule (lint-shared.mjs). */
export interface Violation {
  line: number;
  col: number;
  kind: string;
  detail: string;
  path?: string;
}

/** DB-facing metadata — the source that `seed-rules` writes into the registry. */
export interface RuleMeta {
  slug: string;
  name: string;
  category: RuleCategory;
  description: string;
  languages: Language[];
  /** Thresholds etc.; serialized to rules.config_json. null when the rule has none. */
  config: Record<string, unknown> | null;
  ratchetable: boolean;
  modes: LintMode[];
  stage: Stage;
}

/** The common wrapper: metadata + execution. */
export interface LintRule {
  meta: RuleMeta;
  /** Run the underlying hook with raw argv (delegates to the .mjs `main`). */
  run(argv: string[]): Promise<void>;
  /** Per-source scan, where the rule exposes one. */
  findViolations?(src: string): Violation[] | Promise<Violation[]>;
}
