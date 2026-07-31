// The plugin contract every rule under `rules/<slug>/` conforms to. A rule is one
// cohesive module: `plugin.mjs` (this shape, JSDoc-typed against this interface),
// `check.mjs` (the un-compiled runner the dispatcher spawns), and optional
// `control.mjs` (a JS-override settings control). The interface is the single
// source of truth; `assertRulePlugin` (load.ts) enforces it at load time since
// the `.mjs` descriptors are not tsc-checked.

import type { Stage } from "./stages.js";
import type {
  Language,
  LintMode,
  RuleActionMeta,
  RuleCategory,
} from "./types.js";

export type { Language, LintMode, RuleCategory, Stage };

/**
 * One field in a declarative settings dialog. panelExt renders any schema
 * generically, so a rule declares its knobs as data instead of shipping UI. The
 * `key` addresses into the rule's `config` object.
 */
export type ControlField =
  | {
      key: string;
      label: string;
      type: "number";
      min?: number;
      max?: number;
      step?: number;
      help?: string;
    }
  | { key: string; label: string; type: "boolean"; help?: string }
  | {
      key: string;
      label: string;
      type: "string";
      placeholder?: string;
      help?: string;
    }
  | { key: string; label: string; type: "list"; help?: string }
  | {
      key: string;
      label: string;
      type: "select";
      options: { value: string; label: string }[];
      help?: string;
    };

/**
 * How a rule's settings dialog is built. `declarative` is the default — a schema
 * panelExt renders generically. `custom` is the escape hatch for the rare rule
 * with bespoke UI: `key` resolves against panelExt's CUSTOM_CONTROLS registry
 * (the prebuilt panel can only be extended through panelExt), and `module` points
 * at the co-located `control.mjs` that ships the browser control.
 */
export type ControlSpec =
  | { kind: "declarative"; fields: ControlField[] }
  | { kind: "custom"; key: string; module?: string };

/**
 * An external tool or npm package a rule's check needs at runtime. Verified by
 * `check-deps` and at install time (warn-only — a missing dep never fails the
 * install, matching the existing resolveTool posture).
 */
export interface RuleDependency {
  kind: "npm" | "bin";
  /** npm package name, or an executable expected on PATH. */
  name: string;
  /** Warn-only even when the rule is enabled. */
  optional?: boolean;
  reason?: string;
}

/** Registry metadata `registerRule` writes to the DB. RuleMeta minus the panel-only bits. */
export interface RulePluginMeta {
  slug: string;
  name: string;
  category: RuleCategory;
  categories?: RuleCategory[];
  description: string;
  languages: Language[];
  config: Record<string, unknown> | null;
  ratchetable: boolean;
  modes: LintMode[];
  stages: Stage[];
  /** Execution/display order, ascending; ties break by slug. Seeds sort_index on first
   *  register only, so a later CLI/panel reorder survives re-seed (like `enabled`). */
  order?: number;
  actions?: RuleActionMeta[];
}

/** The whole plugin: metadata, settings control, dependencies, and the check entry. */
export interface RulePlugin {
  meta: RulePluginMeta;
  /** Settings dialog spec; omit for the default dialog (enabled/languages/action/config). */
  control?: ControlSpec;
  dependencies?: RuleDependency[];
  /**
   * Package-relative path to the check's `.mjs` (e.g. "./check.mjs"), resolved by
   * the loader against the plugin's own directory. null for a policy-only rule
   * with no local runner (e.g. gov-require-pr, stage: server).
   */
  checkEntry: string | null;
  /**
   * Absolute path to the check runner — the loader stamps it by resolving
   * `checkEntry` against the discovered plugin's base dir (a folder under `rules/`
   * or an installed package). Not authored in plugin.mjs; null mirrors
   * `checkEntry === null`.
   */
  checkPath?: string | null;
}
