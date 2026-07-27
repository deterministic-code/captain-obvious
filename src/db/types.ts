// Row and option-bag types for the captain-obvious registry.

/** Action-type slugs seeded by open.ts. New ones can be added via configure-action. */
export type ActionSlug = "warn" | "halt" | "delay_halt";

/** Environment slugs seeded by open.ts. */
export type EnvironmentSlug = "claude" | "cursor" | "github";

// --- Row shapes (as returned by better-sqlite3) ---------------------------

export interface LanguageRow {
  id: number;
  slug: string;
  name: string;
  extensions: string | null;
}

export interface RuleRow {
  id: number;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  config_json: string | null;
  enabled: number;
}

export interface ActionTypeRow {
  id: number;
  slug: string;
  name: string;
}

export interface RuleActionRow {
  id: number;
  rule_id: number;
  environment_id: number | null;
  action_type_id: number;
  delay_ms: number | null;
}

/**
 * A rule action's kind (stored in the `fixes` table). 'script' runs a
 * deterministic fix (e.g. prettier --write); 'inferred' delegates the fix to the
 * model/inference; 'output' just reports to the user. A rule may have zero
 * actions (check only).
 */
export type FixKind = "inferred" | "script" | "output";

export interface FixRow {
  id: number;
  rule_id: number;
  kind: string;
  language_id: number | null;
  script_path: string | null;
  script_body: string | null;
  description: string | null;
}

// --- Command option bags --------------------------------------------------

export interface AddLanguageOpts {
  slug: string;
  name: string;
  /** File extensions without the dot, e.g. ["ts", "tsx"]. */
  extensions?: string[];
}

export interface AddRuleOpts {
  slug: string;
  name: string;
  category?: string;
  description?: string;
  /** Language slugs to link. Each must already exist. */
  languages?: string[];
  /** Raw JSON string for config_json (validated as JSON before write). */
  config?: string;
  /** Hook slugs to link. Each must already exist. */
  hooks?: string[];
}

/** A parsed `--set-action <type>[:<env>][:<delayMs>]` value. */
export interface ActionBinding {
  /** Action-type slug (must exist). */
  type: string;
  /** Environment slug, or null for the default (all-env) binding. */
  environment: string | null;
  /** Per-binding delay override in ms, or null. */
  delayMs: number | null;
}

export interface ConfigureRuleOpts {
  setConfig?: string;
  enabled?: boolean;
  addLanguages?: string[];
  removeLanguages?: string[];
  setAction?: ActionBinding;
  /** Environment slug to remove, or "all" to clear every binding. */
  removeAction?: string;
}

export interface ConfigureActionOpts {
  /** Create the action type if it does not exist. */
  add?: boolean;
  name?: string;
}
