/**
 * Deterministic "tools" that summarize the enabled rules into human-readable
 * documents: a bullet-point style guide and a set of multi-sentence inference
 * rules. Both read straight from the registry (no model), so the output is a
 * faithful, reproducible rendering of what the enabled rules actually enforce.
 */
import type { Db } from "../db/open.js";
import { listProjectRules, listRules, type RuleView } from "./registry.js";

export interface ToolDoc {
  text: string;
}

function enabledRules(db: Db, projectId: number | null): RuleView[] {
  const rules =
    projectId === null ? listRules(db) : listProjectRules(db, projectId);
  return rules.filter((r) => r.enabled);
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function configPairs(config: Record<string, unknown> | null): string[] {
  if (!config) return [];
  return Object.entries(config).map(([k, v]) => `${k}: ${formatValue(v)}`);
}

function ensurePeriod(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function buildStyleGuide(rules: RuleView[]): string {
  const lines = ["# Style Guide", ""];
  if (rules.length === 0) {
    lines.push("_No rules are enabled._");
    return `${lines.join("\n")}\n`;
  }
  const noun = rules.length === 1 ? "rule is" : "rules are";
  lines.push(`The following ${rules.length} ${noun} enforced:`, "");
  for (const rule of rules) {
    const cfg = configPairs(rule.config);
    const suffix = cfg.length ? ` (${cfg.join("; ")})` : "";
    lines.push(
      `- **${rule.name}** — ${rule.description ?? rule.name}${suffix}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

// Where the rule runs and how strictly, from its stages and default action.
function describePosture(rule: RuleView): string {
  const stage = rule.stages.length ? rule.stages.join(" and ") : null;
  const action = rule.defaultAction?.type ?? null;
  if (stage && action)
    return `This rule runs at ${stage} and defaults to ${action}.`;
  if (stage) return `This rule runs at ${stage}.`;
  if (action) return `This rule defaults to ${action}.`;
  return "";
}

function inferenceParagraph(rule: RuleView): string {
  const sentences: string[] = [];
  if (rule.description) sentences.push(ensurePeriod(rule.description));
  const cfg = configPairs(rule.config);
  if (cfg.length)
    sentences.push(ensurePeriod(`Configured thresholds: ${cfg.join("; ")}`));
  for (const action of rule.actions) {
    if (action.description) sentences.push(ensurePeriod(action.description));
  }
  const posture = describePosture(rule);
  if (posture) sentences.push(posture);
  if (sentences.length === 0) sentences.push(ensurePeriod(rule.name));
  return sentences.join(" ");
}

export function buildInferenceRules(rules: RuleView[]): string {
  const lines = ["# Inference Rules", ""];
  if (rules.length === 0) {
    lines.push("_No rules are enabled._");
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    "Natural-language rules to apply when writing or reviewing code:",
    "",
  );
  for (const rule of rules) {
    lines.push(`## ${rule.name}`, inferenceParagraph(rule), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function styleGuide(db: Db, projectId: number | null): ToolDoc {
  return { text: buildStyleGuide(enabledRules(db, projectId)) };
}

export function inferenceRules(db: Db, projectId: number | null): ToolDoc {
  return { text: buildInferenceRules(enabledRules(db, projectId)) };
}
