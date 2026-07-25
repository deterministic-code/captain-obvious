#!/usr/bin/env node
import {
  formatViolation,
  isInvokedAsScript,
  lintFileWith,
  runFileHook,
} from "./lint-shared.mjs";

const REGEX_PREV = new Set([..."(,=:[!&|?{;<>+-*%^~", ""]);

/** Interpolation-aware source stripper. Blanks comments and string/regex literals to spaces (offsets preserved) while KEEPING the code inside `${…}` template interpolations — where `${snakeToPascal(x)}Service` / `/api/${kebabPlural(x)}` bypasses live. The shared `stripStringsAndComments` blanks the whole template body, so this hook needs its own pass. */
class Scanner {
  constructor(src) {
    this.src = src;
    this.n = src.length;
    this.i = 0;
    this.out = [];
  }
  blank(ch) {
    this.out.push(ch === "\n" ? "\n" : " ");
  }
  keep(ch) {
    this.out.push(ch);
  }
  atEscape() {
    return this.src[this.i] === "\\" && this.i + 1 < this.n;
  }
  consumeEscape() {
    this.blank(this.src[this.i]);
    this.blank(this.src[this.i + 1]);
    this.i += 2;
  }
  lastKept() {
    for (let k = this.out.length - 1; k >= 0; k--) {
      if (this.out[k] !== " " && this.out[k] !== "\n") return this.out[k];
    }
    return "";
  }
  comment(isBlock) {
    this.blank(" ");
    this.blank(" ");
    this.i += 2;
    const end = () =>
      isBlock
        ? this.src[this.i] === "*" && this.src[this.i + 1] === "/"
        : this.src[this.i] === "\n";
    while (this.i < this.n && !end()) this.blank(this.src[this.i++]);
    if (isBlock && this.i < this.n) {
      this.blank(" ");
      this.blank(" ");
      this.i += 2;
    }
  }
  quoted(q) {
    this.keep(this.src[this.i++]);
    while (this.i < this.n) {
      if (this.atEscape()) this.consumeEscape();
      else if (this.src[this.i] === q) return this.keep(this.src[this.i++]);
      else if (this.src[this.i] === "\n") return this.blank(this.src[this.i++]);
      else this.blank(this.src[this.i++]);
    }
  }
  regex() {
    this.keep(this.src[this.i++]);
    let inClass = false;
    while (this.i < this.n && this.src[this.i] !== "\n") {
      const c = this.src[this.i];
      if (this.atEscape()) this.consumeEscape();
      else if (!inClass && c === "/") {
        this.keep(this.src[this.i++]);
        while (this.i < this.n && /[a-z]/i.test(this.src[this.i]))
          this.keep(this.src[this.i++]);
        return;
      } else {
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        this.blank(this.src[this.i++]);
      }
    }
  }
  template() {
    this.keep(this.src[this.i++]);
    while (this.i < this.n) {
      if (this.atEscape()) this.consumeEscape();
      else if (this.src[this.i] === "`") return this.keep(this.src[this.i++]);
      else if (this.src[this.i] === "$" && this.src[this.i + 1] === "{") {
        this.keep(this.src[this.i++]);
        this.keep(this.src[this.i++]);
        this.scan(true);
      } else this.blank(this.src[this.i++]);
    }
  }
  consumeLiteral() {
    const c = this.src[this.i];
    const d = this.src[this.i + 1];
    if (c === "/" && d === "/") this.comment(false);
    else if (c === "/" && d === "*") this.comment(true);
    else if (c === "'" || c === '"') this.quoted(c);
    else if (c === "`") this.template();
    else if (c === "/" && REGEX_PREV.has(this.lastKept())) this.regex();
    else return false;
    return true;
  }
  scan(insideInterp) {
    let depth = 0;
    while (this.i < this.n) {
      if (this.consumeLiteral()) continue;
      const c = this.src[this.i];
      if (insideInterp && c === "}" && depth === 0)
        return this.keep(this.src[this.i++]);
      if (insideInterp && c === "{") depth++;
      else if (insideInterp && c === "}") depth--;
      this.keep(this.src[this.i++]);
    }
  }
  run() {
    this.scan(false);
    return this.out.join("");
  }
}

export function scannableSource(src) {
  return new Scanner(src).run();
}

/** Casing/pluralization helpers from `@deterministic-code/emitter-sdk/case` that hardcode a target format — emitters must derive names/paths through CodegenNames/CodegenLayout (namesFor/layoutFor) instead, so a consumer's backend_settings.yaml casing is honored. Structural helpers (resolveAutoCasing, tokenize, caseVariantsOf, CASE_FORMATS) are not casing applications and stay allowed. */
export const FORBIDDEN = new Set([
  "toCase",
  "kebab",
  "snake",
  "pascal",
  "kebabToSnake",
  "snakeToCamel",
  "snakeToPascal",
  "snakeToKebab",
  "camelToSnake",
  "kebabPlural",
  "camelPlural",
  "apiPathSegment",
  "pluralize",
]);

const CASE_MODULE = "@deterministic-code/emitter-sdk/case";
const ALLOW_RE = /lint-emitter-casing-allow:\s*([^\n]*)/;

/** The emitter fence: `emit-*.mjs` and `*-emit.mjs` under `scripts/codegen/lib/`, excluding colocated `__tests__/` unit tests (those reference emitted names but are not emitters themselves). */
export function isEmitterFile(path) {
  const norm = path.replace(/\\/g, "/");
  if (!norm.includes("scripts/codegen/lib/")) return false;
  if (norm.includes("/__tests__/")) return false;
  const base = norm.slice(norm.lastIndexOf("/") + 1);
  if (!base.endsWith(".mjs")) return false;
  return base.startsWith("emit-") || base.endsWith("-emit.mjs");
}

/** Map of local binding → the forbidden original it aliases, for every `{ … } from ".../case"` import in the source. `name as alias` is respected so the call-site scan matches the local name. */
function forbiddenBindings(src) {
  const bindings = new Map();
  const importRe = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${CASE_MODULE.replace(/\//g, "\\/")}["']`,
    "g",
  );
  let m;
  while ((m = importRe.exec(src)) !== null) {
    for (const raw of m[1].split(",")) {
      const entry = raw.trim();
      if (!entry) continue;
      const parts = entry.split(/\s+as\s+/);
      const original = parts[0].trim();
      const local = (parts[1] ?? parts[0]).trim();
      if (FORBIDDEN.has(original)) bindings.set(local, original);
    }
  }
  return bindings;
}

/** For each source line, the set of idents an inline `lint-emitter-casing-allow:` directive permits (empty set = allow all). A violation is suppressed when its line, or the line directly above it, carries a matching directive. */
function allowDirectives(src) {
  const perLine = new Map();
  src.split("\n").forEach((text, i) => {
    const hit = ALLOW_RE.exec(text);
    if (!hit) return;
    const idents = hit[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    perLine.set(i + 1, new Set(idents));
  });
  return perLine;
}

function isAllowed(perLine, line, { original, local }) {
  for (const at of [line, line - 1]) {
    const allowed = perLine.get(at);
    if (!allowed) continue;
    if (allowed.size === 0) return true;
    if (allowed.has(original) || allowed.has(local)) return true;
  }
  return false;
}

export function findViolations(src) {
  const bindings = forbiddenBindings(src);
  if (bindings.size === 0) return [];
  const stripped = scannableSource(src);
  const perLine = allowDirectives(src);
  const violations = [];
  for (const [local, original] of bindings) {
    const callRe = new RegExp(`\\b${local}\\s*\\(`, "g");
    let m;
    while ((m = callRe.exec(stripped)) !== null) {
      const line = src.slice(0, m.index).split("\n").length;
      if (isAllowed(perLine, line, { original, local })) continue;
      violations.push({
        line,
        col: m.index - src.lastIndexOf("\n", m.index - 1),
        kind: `hardcoded casing helper \`${original}\``,
        detail: `\`${original}(…)\` hardcodes one casing/pluralization and ignores backend_settings.yaml. Derive through CodegenNames/CodegenLayout instead — names.className/fileBase, names.classNamePlural/fileBasePlural, layout.apiPath/filePath/featurePath (via namesFor/layoutFor). If this is a language-invariant runtime symbol (a JS fn name, a Zod schema var), add \`// lint-emitter-casing-allow: ${original}\` on this line.`,
      });
    }
  }
  return violations;
}

export const lintFile = (path, cwd) => lintFileWith(path, cwd, findViolations);

export { formatViolation };

function usage() {
  process.stderr.write(
    "Usage:\n  node scripts/hooks/lint-emitter-casing.mjs --staged [--warn]\n  node scripts/hooks/lint-emitter-casing.mjs --all [--warn]\n  node scripts/hooks/lint-emitter-casing.mjs --files <path> [...] [--warn]\n",
  );
}

export function main(argv) {
  return runFileHook(argv, {
    usage,
    collect: (path) => (isEmitterFile(path) ? lintFile(path) : []),
    okLine: "lint-emitter-casing: no hardcoded casing helpers in emitters",
    summary: (n) =>
      `lint-emitter-casing: ${n} violation(s). Emitters must derive names/paths through CodegenNames/CodegenLayout, not case.mjs helpers. See CLAUDE.md “Naming and layout are SDK-owned”.`,
  });
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-emitter-casing: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
