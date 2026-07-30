import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = "/Users/ryan/Projects/captain-obvious/.worktrees/rules-plugins";
const { RULES } = await import(resolve(root, "core/dist/rules/index.js"));

const DONE = new Set(["lint-max-lines", "lint-prettier"]);
const KIT = "@deterministic-code/co-rule-kit";
const CORE = "@deterministic-code/captain-obvious";
const pkgName = (slug) => `@deterministic-code/co-rule-${slug}`;
const TOOL_VERSION = { jscpd: "^3.5.10", knip: "^6.24.0", prettier: "^3.4.0" };

const converted = [];
for (const r of RULES) {
  const slug = r.meta.slug;
  if (DONE.has(slug)) continue;
  const dir = resolve(root, "rules", slug);
  const deps = {};
  const hasCheck = r.checkEntry !== null;

  if (hasCheck) {
    let src = readFileSync(resolve(dir, "check.mjs"), "utf8");
    if (/\.\.\/_kit\//.test(src)) {
      deps[KIT] = "^0.1.2";
      src = src.replace(/"\.\.\/_kit\/([a-z0-9-]+)\.mjs"/g, `"${KIT}/$1"`);
    }
    // cross-rule check imports (e.g. lint-dup-fn -> lint-dup-structural)
    src = src.replace(/"\.\.\/([a-z0-9-]+)\/check\.mjs"/g, (_m, other) => {
      deps[pkgName(other)] = "^0.1.2";
      return `"${pkgName(other)}/check.mjs"`;
    });
    if (src.includes(`${CORE}/`)) deps[CORE] = "^0.1.2";
    writeFileSync(resolve(dir, "check.mjs"), src);
  }

  for (const d of r.dependencies ?? []) {
    if (d.kind === "npm") deps[d.name] = TOOL_VERSION[d.name] ?? "*";
  }

  const exportsMap = { "./plugin.mjs": "./plugin.mjs", "./package.json": "./package.json" };
  const files = ["plugin.mjs"];
  if (hasCheck) {
    exportsMap["./check.mjs"] = "./check.mjs";
    files.push("check.mjs");
  }
  const pkg = {
    name: pkgName(slug),
    version: "0.1.2",
    type: "module",
    license: "MIT",
    exports: exportsMap,
    files,
    ...(Object.keys(deps).length ? { dependencies: deps } : {}),
  };
  writeFileSync(resolve(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  converted.push(slug);
}

// All rule slugs (converted + the 2 already-packaged) for workspaces + config.
const allSlugs = RULES.map((r) => r.meta.slug).sort();
console.log(`converted ${converted.length} rules`);
console.log(JSON.stringify({ workspaces: ["core", "rules/_kit", ...allSlugs.map((s) => `rules/${s}`)], plugins: allSlugs.map(pkgName) }, null, 2));
