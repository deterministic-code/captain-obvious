#!/usr/bin/env node
// Lockstep release tool for the captain-obvious monorepo.
//
//   node release.mjs bump <patch|minor|major|x.y.z> [--dry-run]
//   node release.mjs publish [--otp=NNNNNN] [--dry-run]
//
// `bump` sets every workspace package (core, kit, all co-rule-* rules, the
// recommended bundle) to one shared version and repoints every internal
// @deterministic-code/* dependency range to ^<version>, then refreshes the
// lockfile. Commit the result on a branch and merge it the usual way BEFORE
// publishing — main is branch-protected, so this tool never pushes.
//
// `publish` builds, then runs `npm publish --access public` for each package in
// dependency order (core -> kit -> rules -> bundle), skipping any name@version
// already on the registry so a re-run after a partial failure is safe. Publish
// works with the existing token; unpublish does not (npm blocks 2FA-bypass
// tokens from destructive actions).

import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(import.meta.url));

const CORE = "@deterministic-code/captain-obvious";
const KIT = "@deterministic-code/co-rule-kit";
const BUNDLE = "@deterministic-code/co-rules-recommended";
const INTERNAL = "@deterministic-code/";
const RULE_PREFIX = "@deterministic-code/co-rule-";
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies"];

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const writeJson = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + "\n");

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: repoRoot, stdio: "inherit" });
}

async function workspaces() {
  const root = await readJson(resolve(repoRoot, "package.json"));
  return Promise.all(
    root.workspaces.map(async (rel) => {
      const manifestPath = resolve(repoRoot, rel, "package.json");
      return { manifestPath, manifest: await readJson(manifestPath) };
    }),
  );
}

/** core -> kit -> rules (alpha) -> bundle: the order deps require to resolve. */
function publishOrder(pkgs) {
  const by = (name) => pkgs.find((p) => p.manifest.name === name);
  const rules = pkgs
    .filter(
      (p) => p.manifest.name.startsWith(RULE_PREFIX) && p.manifest.name !== KIT,
    )
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  return [by(CORE), by(KIT), ...rules, by(BUNDLE)].filter(Boolean);
}

function nextVersion(current, spec) {
  if (/^\d+\.\d+\.\d+$/.test(spec)) return spec;
  const [maj, min, pat] = current.split(".").map(Number);
  if (spec === "major") return `${maj + 1}.0.0`;
  if (spec === "minor") return `${maj}.${min + 1}.0`;
  if (spec === "patch") return `${maj}.${min}.${pat + 1}`;
  throw new Error(
    `bad version spec: ${spec} (use patch | minor | major | x.y.z)`,
  );
}

/** True if name@version already exists; false on a genuine 404, else rethrow. */
function isPublished(name, version) {
  try {
    const out = execFileSync("npm", ["view", `${name}@${version}`, "version"], {
      cwd: repoRoot,
      encoding: "utf8",
      // Capture stderr instead of the Sync default (inherit) so an expected
      // "version not published yet" 404 doesn't spew npm noise to the terminal.
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return out === version;
  } catch (err) {
    const text = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (/E404|is not in this registry|No match/i.test(text)) return false;
    throw err;
  }
}

async function bump(spec, dryRun) {
  const pkgs = await workspaces();
  const core = pkgs.find((p) => p.manifest.name === CORE);
  if (!core) throw new Error(`${CORE} not found among workspaces`);
  const next = nextVersion(core.manifest.version, spec);
  console.log(
    `bump ${core.manifest.version} -> ${next}${dryRun ? "  (dry-run)" : ""}`,
  );

  for (const { manifestPath, manifest } of pkgs) {
    manifest.version = next;
    for (const field of DEP_FIELDS) {
      const deps = manifest[field];
      if (!deps) continue;
      for (const dep of Object.keys(deps)) {
        if (dep.startsWith(INTERNAL)) deps[dep] = `^${next}`;
      }
    }
    console.log(`  ${manifest.name}`);
    if (!dryRun) await writeJson(manifestPath, manifest);
  }

  if (dryRun) {
    console.log("dry-run: no files written, lockfile not refreshed");
    return;
  }
  run("npm", ["install", "--package-lock-only", "--ignore-scripts"]);
  console.log(
    `done. commit on a branch, PR + merge, then: node release.mjs publish`,
  );
}

async function publish(otp, dryRun) {
  if (!dryRun) run("npx", ["tsc", "-p", "core/tsconfig.json"]);
  const order = publishOrder(await workspaces());
  console.log(
    `publish order (${order.length}): ${order.map((p) => p.manifest.name.replace(INTERNAL, "")).join(" -> ")}`,
  );
  const otpArgs = otp ? ["--otp", otp] : [];

  let published = 0;
  let skipped = 0;
  for (const { manifest } of order) {
    const { name, version } = manifest;
    if (isPublished(name, version)) {
      console.log(`skip    ${name}@${version} (already on registry)`);
      skipped++;
      continue;
    }
    console.log(`${dryRun ? "would  " : "publish"} ${name}@${version}`);
    if (!dryRun)
      run("npm", [
        "publish",
        "--workspace",
        name,
        "--access",
        "public",
        ...otpArgs,
      ]);
    published++;
  }
  console.log(
    `--- ${dryRun ? "dry-run " : ""}published=${published} skipped=${skipped} ---`,
  );
}

const [, , sub, ...rest] = process.argv;
const dryRun = rest.includes("--dry-run");
const otp =
  (rest.find((a) => a.startsWith("--otp=")) ?? "").split("=")[1] || null;

if (sub === "bump") {
  const spec = rest.find((a) => !a.startsWith("--"));
  if (!spec)
    throw new Error(
      "usage: node release.mjs bump <patch|minor|major|x.y.z> [--dry-run]",
    );
  await bump(spec, dryRun);
} else if (sub === "publish") {
  await publish(otp, dryRun);
} else {
  console.log(
    "usage:\n" +
      "  node release.mjs bump <patch|minor|major|x.y.z> [--dry-run]\n" +
      "  node release.mjs publish [--otp=NNNNNN] [--dry-run]",
  );
  process.exit(sub ? 1 : 0);
}
