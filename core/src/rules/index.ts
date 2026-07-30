import { loadPlugins } from "./load.js";
import type { RulePlugin } from "./plugin.js";

/**
 * The bundled rule set: every plugin discovered under `rules/<slug>/`. Feeds
 * `seed-rules` and the dispatcher; the registry DB is the home of record, this
 * only seeds it. Drop a new `rules/<slug>/plugin.mjs` and it registers itself.
 */
export const RULES: RulePlugin[] = await loadPlugins();
