import { discoverRules } from "./load.js";
import type { RulePlugin } from "./plugin.js";

/**
 * The rule set feeding `seed-rules` and the dispatcher: installed `co-rule-*`
 * packages (a consumer install, discovered from `node_modules` by keyword) unioned
 * with the in-repo `rules/<slug>/` scan (monorepo dogfooding). The registry DB is
 * the home of record; this only seeds it. Drop in a rule package or a
 * `rules/<slug>/plugin.mjs` and it registers itself.
 */
export const RULES: RulePlugin[] = await discoverRules();
