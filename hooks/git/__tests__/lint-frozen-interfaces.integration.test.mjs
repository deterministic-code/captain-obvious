import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addTarget,
  collectViolations,
  loadFrozenFile,
  refreshManifest,
} from "../frozen-interfaces-metrics.mjs";

const SRC = "export class EmitPlan {\n  write() {}\n  add(entries) {}\n}\n";
const REL = "scripts/codegen/lib/writers.mjs";
const KEY = `${REL}#EmitPlan`;

describe("frozen-interfaces external YAML round-trip", () => {
  let root;
  const writeSource = (body) => writeFile(join(root, REL), body, "utf8");

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "frozen-int-"));
    await mkdir(join(root, "scripts/codegen/lib"), { recursive: true });
    await writeSource(SRC);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("--add baselines the current signature so a clean tree has no drift", async () => {
    const manifest = await addTarget(root, {}, { key: KEY, scopeRaw: "" });
    expect(manifest[KEY].fingerprint.members).toEqual({
      write: "()",
      add: "(entries)",
    });
    expect(await collectViolations(root, manifest)).toEqual([]);
  });

  test("a frozen signature that grows an argument is reported as drift", async () => {
    const manifest = await addTarget(root, {}, { key: KEY, scopeRaw: "" });
    await writeSource(SRC.replace("write() {}", "write(opts) {}"));
    const violations = await collectViolations(root, manifest);
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain("changed write: () → (opts)");
  });

  test("deleting the frozen type is itself a violation, not a silent pass", async () => {
    const manifest = await addTarget(root, {}, { key: KEY, scopeRaw: "" });
    await writeSource("export class Unrelated {}\n");
    const violations = await collectViolations(root, manifest);
    expect(violations[0].detail).toContain('frozen type "EmitPlan" not found');
  });

  test("--update re-baselines a deliberate change back to green", async () => {
    const manifest = await addTarget(root, {}, { key: KEY, scopeRaw: "" });
    await writeSource(SRC.replace("write() {}", "write(opts) {}"));
    const rebaselined = await refreshManifest(root, manifest);
    expect(await collectViolations(root, rebaselined)).toEqual([]);
  });

  test("loadFrozenFile returns an empty manifest when the YAML is absent", async () => {
    expect(await loadFrozenFile(join(root, "interface-frozen.yaml"))).toEqual(
      {},
    );
  });
});
