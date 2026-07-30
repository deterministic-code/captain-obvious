#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import { emitHookReport, repoRootOf } from "./lint-shared.mjs";
import { parseSourceFile } from "./fn-metrics.mjs";

export const FROZEN_FILE = "interface-frozen.yaml";
const UPDATE_CMD = "npm run lint:frozen-interfaces:update";
const CHECK_MODES = new Set(["--staged", "--all", "--files"]);
const FROZEN_HEADER =
  "# Frozen interface baselines — the external source of truth for which class/interface\n" +
  "# signatures are locked. DO NOT hand-edit: add a target with\n" +
  "#   npm run lint:frozen-interfaces:add -- <path>#<ClassName> [constructor,methods,heritage]\n" +
  "# and re-baseline a deliberate change with `npm run lint:frozen-interfaces:update`.\n";

const SCOPE_ALIASES = {
  constructor: "constructor",
  ctor: "constructor",
  methods: "members",
  members: "members",
  properties: "members",
  heritage: "heritage",
  implements: "heritage",
  extends: "heritage",
  interface: "heritage",
};
const ALL_SCOPES = ["heritage", "constructor", "members"];

export function parseScopes(raw) {
  const tokens = (raw ?? "").split(/[,\s]+/).filter(Boolean);
  const scopes = new Set();
  for (const token of tokens) {
    const canon = SCOPE_ALIASES[token.toLowerCase()];
    if (!canon) {
      throw new Error(
        `unknown frozen scope "${token}" (use constructor, methods, heritage)`,
      );
    }
    scopes.add(canon);
  }
  return scopes.size ? [...scopes] : [...ALL_SCOPES];
}

function collapse(text) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeSig(sf, params, type) {
  // Unreachable: every caller passes a defined array (decls have .parameters; the getter passes []).
  /* v8 ignore next */
  const inner = (params ?? []).map((p) => p.getText(sf)).join(", ");
  const ret = type ? `: ${type.getText(sf)}` : "";
  return collapse(`(${inner})${ret}`);
}

function isPrivate(member) {
  if (member.name && ts.isPrivateIdentifier(member.name)) return true;
  const mods = ts.getModifiers(member) ?? [];
  return mods.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword);
}

function modifierPrefix(member) {
  const mods = (ts.getModifiers(member) ?? [])
    .map((m) => m.getText())
    .filter((m) => m !== "public");
  return mods.length ? `${mods.join(" ")} ` : "";
}

function memberName(member) {
  const name = member.name;
  if (!name) return "<anon>";
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return collapse(name.getText());
}

function memberSignature(sf, member) {
  const prefix = modifierPrefix(member);
  if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
    return `${prefix}${normalizeSig(sf, member.parameters, member.type)}`;
  }
  if (ts.isGetAccessor(member)) {
    return `${prefix}get${normalizeSig(sf, [], member.type)}`;
  }
  if (ts.isSetAccessor(member)) {
    return `${prefix}set${normalizeSig(sf, member.parameters, null)}`;
  }
  const opt = member.questionToken ? "?" : "";
  const type = member.type ? `: ${member.type.getText(sf)}` : "";
  return collapse(`${prefix}${opt}${type}`);
}

function membersOf(sf, node) {
  const out = {};
  for (const member of node.members) {
    if (ts.isConstructorDeclaration(member) || isPrivate(member)) continue;
    const name = memberName(member);
    const sig = memberSignature(sf, member);
    out[name] = name in out ? `${out[name]} | ${sig}` : sig;
  }
  return Object.fromEntries(
    Object.keys(out)
      .sort()
      .map((k) => [k, out[k]]),
  );
}

function constructorOf(sf, node) {
  const ctor = node.members.find((m) => ts.isConstructorDeclaration(m));
  return ctor ? normalizeSig(sf, ctor.parameters, null) : null;
}

function heritageOf(node) {
  const ext = [];
  const impl = [];
  for (const clause of node.heritageClauses ?? []) {
    const names = clause.types.map((t) => collapse(t.getText()));
    if (clause.token === ts.SyntaxKind.ExtendsKeyword) ext.push(...names);
    else impl.push(...names);
  }
  return { extends: ext.sort(), implements: impl.sort() };
}

export function fingerprintOf(sf, node) {
  const isClass = ts.isClassDeclaration(node);
  return {
    kind: isClass ? "class" : "interface",
    heritage: heritageOf(node),
    constructor: isClass ? constructorOf(sf, node) : null,
    members: membersOf(sf, node),
  };
}

export function fingerprintNamedType(sf, name) {
  for (const node of sf.statements) {
    const declared =
      ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node);
    if (!declared || node.name?.text !== name) continue;
    const at = sf.getLineAndCharacterOfPosition(node.name.getStart(sf));
    return {
      line: at.line + 1,
      col: at.character + 1,
      fingerprint: fingerprintOf(sf, node),
    };
  }
  return null;
}

export function keyToTarget(key) {
  const hash = key.lastIndexOf("#");
  if (hash <= 0 || hash === key.length - 1) {
    throw new Error(
      `invalid frozen target "${key}" — expected <path>#<ClassName>`,
    );
  }
  return { path: key.slice(0, hash), name: key.slice(hash + 1) };
}

function heritageStr(h) {
  return `extends [${h.extends.join(", ")}] implements [${h.implements.join(", ")}]`;
}

function diffMembers(expected, actual, changes) {
  for (const name of Object.keys(actual)) {
    if (!(name in expected))
      changes.push(`added member ${name}${actual[name]}`);
    else if (expected[name] !== actual[name]) {
      changes.push(`changed ${name}: ${expected[name]} → ${actual[name]}`);
    }
  }
  for (const name of Object.keys(expected)) {
    if (!(name in actual))
      changes.push(`removed member ${name}${expected[name]}`);
  }
}

export function diffFingerprint(expected, actual, scope) {
  const changes = [];
  if (scope.includes("heritage")) {
    const e = heritageStr(expected.heritage);
    const a = heritageStr(actual.heritage);
    if (e !== a) changes.push(`heritage ${e} → ${a}`);
  }
  if (scope.includes("constructor")) {
    const e = expected.constructor ?? "(none)";
    const a = actual.constructor ?? "(none)";
    if (e !== a) changes.push(`constructor ${e} → ${a}`);
  }
  if (scope.includes("members"))
    diffMembers(expected.members, actual.members, changes);
  return changes;
}

function mkViolation(loc, detail) {
  return {
    path: loc.path,
    line: loc.line ?? 1,
    col: loc.col ?? 1,
    kind: "frozen",
    detail,
  };
}

async function loadNamedType(repoRoot, path, name) {
  const src = await readFile(join(repoRoot, path), "utf8").then(
    (s) => s,
    (err) => {
      if (err.code === "ENOENT" || err.code === "EISDIR") return null;
      throw err;
    },
  );
  return src === null
    ? null
    : fingerprintNamedType(parseSourceFile(path, src), name);
}

async function entryViolation(repoRoot, key, entry) {
  const { path, name } = keyToTarget(key);
  const found = await loadNamedType(repoRoot, path, name);
  if (!found) {
    return mkViolation(
      { path },
      `frozen type "${name}" not found in ${path} — restore it, or remove its entry from ${FROZEN_FILE}`,
    );
  }
  if (!entry.fingerprint) {
    return mkViolation(
      { path, ...found },
      `"${name}" has no baseline yet — run \`${UPDATE_CMD}\``,
    );
  }
  const changes = diffFingerprint(
    entry.fingerprint,
    found.fingerprint,
    entry.scope ?? ALL_SCOPES,
  );
  if (changes.length === 0) return null;
  return mkViolation(
    { path, line: found.line, col: found.col },
    `frozen interface "${name}" changed:\n      ${changes.join("\n      ")}\n    revert it, or run \`${UPDATE_CMD}\` to re-baseline deliberately`,
  );
}

export async function collectViolations(repoRoot, manifest) {
  const found = await Promise.all(
    Object.entries(manifest).map(([key, entry]) =>
      entryViolation(repoRoot, key, entry),
    ),
  );
  return found.filter(Boolean);
}

export async function loadFrozenFile(frozenPath) {
  const raw = await readFile(frozenPath, "utf8").then(
    (s) => s,
    (err) => {
      if (err.code === "ENOENT") return null;
      throw err;
    },
  );
  return raw === null ? {} : (parseYaml(raw) ?? {});
}

async function writeFrozenFile(frozenPath, manifest) {
  const sorted = {};
  for (const key of Object.keys(manifest).sort()) sorted[key] = manifest[key];
  await writeFile(
    frozenPath,
    `${FROZEN_HEADER}${yamlStringify(sorted)}`,
    "utf8",
  );
}

export async function refreshManifest(repoRoot, manifest) {
  const out = {};
  for (const key of Object.keys(manifest)) {
    const { path, name } = keyToTarget(key);
    const found = await loadNamedType(repoRoot, path, name);
    if (!found) throw new Error(`frozen type "${name}" not found in ${path}`);
    out[key] = {
      scope: manifest[key].scope ?? ALL_SCOPES,
      fingerprint: found.fingerprint,
    };
  }
  return out;
}

export async function addTarget(repoRoot, manifest, target) {
  const { path, name } = keyToTarget(target.key);
  const found = await loadNamedType(repoRoot, path, name);
  if (!found) throw new Error(`frozen type "${name}" not found in ${path}`);
  return {
    ...manifest,
    [target.key]: {
      scope: parseScopes(target.scopeRaw),
      fingerprint: found.fingerprint,
    },
  };
}

function usage() {
  process.stderr.write(
    `Freeze class/interface signatures against arg-creep. The frozen set lives in\n` +
      `${FROZEN_FILE} (external, human-owned) — never in the source.\n\n` +
      `  node scripts/hooks/lint-frozen-interfaces.mjs --staged          (pre-commit gate)\n` +
      `  node scripts/hooks/lint-frozen-interfaces.mjs --all             (audit every frozen type)\n` +
      `  node scripts/hooks/lint-frozen-interfaces.mjs --add <path>#<Class> [scopes]\n` +
      `  node scripts/hooks/lint-frozen-interfaces.mjs --update          (re-baseline deliberately)\n`,
  );
}

async function runAdd(ctx, args) {
  const key = args[1];
  if (!key) {
    usage();
    process.exit(2);
  }
  const next = await addTarget(ctx.repoRoot, ctx.manifest, {
    key,
    scopeRaw: args.slice(2).join(","),
  });
  await writeFrozenFile(ctx.frozenPath, next);
  process.stdout.write(`FROZEN: recorded ${key} → ${FROZEN_FILE}\n`);
}

async function runUpdate(ctx) {
  const next = await refreshManifest(ctx.repoRoot, ctx.manifest);
  await writeFrozenFile(ctx.frozenPath, next);
  process.stdout.write(
    `FROZEN: re-baselined ${Object.keys(next).length} frozen interface(s) → ${FROZEN_FILE}\n`,
  );
}

export async function runFrozenHook(argv) {
  const args = argv.slice(2);
  const mode = args[0];
  const repoRoot = await repoRootOf(process.cwd());
  const frozenPath = join(repoRoot, FROZEN_FILE);
  const manifest = await loadFrozenFile(frozenPath);
  const ctx = { repoRoot, frozenPath, manifest };
  if (mode === "--add") return runAdd(ctx, args);
  if (mode === "--update") return runUpdate(ctx);
  if (!CHECK_MODES.has(mode)) {
    usage();
    process.exit(2);
  }
  const violations = await collectViolations(repoRoot, manifest);
  emitHookReport(violations, {
    mode,
    okLine: "FROZEN: no frozen-interface drift",
    summaryLine: `FROZEN: ${violations.length} frozen interface(s) drifted — a frozen signature must not change unless you deliberately re-baseline with \`${UPDATE_CMD}\`.`,
  });
}
