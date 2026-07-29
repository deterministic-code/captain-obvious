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
  /** 1 when the bundled rule set can police this language today, else 0. */
  is_supported: number;
}

export interface RuleRow {
  id: number;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  config_json: string | null;
  /** JSON array of custom panel control keys, or null (default dialog only). */
  settings_controls: string | null;
  enabled: number;
}

export interface ActionTypeRow {
  id: number;
  slug: string;
  name: string;
}

export interface ProjectRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  /** JSON array of absolute file paths, or null. */
  files: string | null;
  /** JSON array of absolute directory paths, or null. */
  directories: string | null;
  /** JSON array of glob patterns the project protects from edits/commits, or null. */
  protected: string | null;
  /** 1 for the repo the hook is installed in, else 0. */
  is_default: number;
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
  /** Primary category (stored on rules.category). */
  category?: string;
  /** Additional categories beyond the primary; the full set is linked in rule_categories. */
  categories?: string[];
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
  /** Categories to link (in addition to the primary). */
  addCategories?: string[];
  /** Categories to unlink. Removing the primary re-points rules.category to the first remaining (or null). */
  removeCategories?: string[];
  setAction?: ActionBinding;
  /** Environment slug to remove, or "all" to clear every binding. */
  removeAction?: string;
}

export interface ConfigureActionOpts {
  /** Create the action type if it does not exist. */
  add?: boolean;
  name?: string;
}

export interface AddProjectOpts {
  name: string;
  description?: string;
  /** Absolute file paths this project scopes to. */
  files?: string[];
  /** Absolute directory paths this project scopes to. */
  directories?: string[];
  /** Glob patterns the project protects from edits/commits. */
  protected?: string[];
}

export interface ConfigureProjectOpts {
  name?: string;
  description?: string;
  /** Replace the project's file list wholesale. */
  files?: string[];
  /** Replace the project's directory list wholesale. */
  directories?: string[];
  /** Replace the project's protected-glob list wholesale. */
  protected?: string[];
}

/** Project-scoped edit of a rule's enabled flag, languages, config, and severity. */
export interface SetProjectRuleOpts {
  enabled?: boolean;
  /** The rule's full desired language set for this project; each slug must exist. */
  languages?: string[];
  /** Raw JSON string for this project's config override, or null to clear it (inherit global). */
  config?: string | null;
  /** Upsert one project-scoped severity binding (default when environment is null). */
  setAction?: ActionBinding;
  /** Environment slug to remove, "default" for the all-env binding, or "all" to clear every binding. */
  removeAction?: string;
}
