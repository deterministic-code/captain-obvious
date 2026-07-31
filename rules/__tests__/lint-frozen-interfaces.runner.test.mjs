import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  addTarget,
  collectViolations,
  loadFrozenFile,
  refreshManifest,
  runFrozenHook,
  FROZEN_FILE,
} from "../_kit/frozen-interfaces-metrics.mjs";
import { main } from "../lint-frozen-interfaces/check.mjs";

const execFileAsync = promisify(execFile);

const SRC = "export class EmitPlan {\n  write() {}\n  add(entries) {}\n}\n";
const REL = "scripts/codegen/lib/writers.mjs";
const KEY = `${REL}#EmitPlan`;

// runFrozenHook resolves the repo root via `git rev-parse` from process.cwd(),
// so the runner tests need a real git repo and must run with cwd inside it.
const initGitRepo = async (root) => {
  await execFileAsync("git", ["init", "-q"], { cwd: root });
};

const captureIo = () => {
  const out = [];
  const err = [];
  const exit = vi.spyOn(process, "exit").mockImplementation(() => {});
  vi.spyOn(process.stdout, "write").mockImplementation((s) => {
    out.push(s);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((s) => {
    err.push(s);
    return true;
  });
  return { out, err, exit };
};

describe("frozen-interfaces runner (runFrozenHook)", () => {
  let root;
  let cwd;
  const writeSource = (body) => writeFile(join(root, REL), body, "utf8");
  const argv = (...args) => ["node", "hook", ...args];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "frozen-run-"));
    await mkdir(join(root, "scripts/codegen/lib"), { recursive: true });
    await writeSource(SRC);
    await initGitRepo(root);
    cwd = process.cwd();
    process.chdir(root);
  });
  afterEach(async () => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  test("--add writes the frozen YAML with a header and re-baselined entry", async () => {
    const { out } = captureIo();
    await runFrozenHook(argv("--add", KEY, "members"));
    expect(out.join("")).toContain(`recorded ${KEY}`);
    const yaml = await readFile(join(root, FROZEN_FILE), "utf8");
    expect(yaml).toContain("# Frozen interface baselines");
    expect(yaml).toContain(KEY);
  });

  test("--add with no target prints usage and exits 2", async () => {
    const { err } = captureIo();
    // real process.exit would halt runAdd before addTarget; make the mock throw
    // a sentinel so the control flow matches production instead of falling through.
    process.exit.mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
    await expect(runFrozenHook(argv("--add"))).rejects.toThrow("exit:2");
    expect(err.join("")).toContain("Freeze class/interface signatures");
  });

  test("--update re-baselines every recorded target and reports the count", async () => {
    let io = captureIo();
    await runFrozenHook(argv("--add", KEY));
    vi.restoreAllMocks();
    // grow the signature, then --update accepts it as the new baseline
    await writeSource(SRC.replace("write() {}", "write(opts) {}"));
    io = captureIo();
    await runFrozenHook(argv("--update"));
    expect(io.out.join("")).toContain("re-baselined 1 frozen interface(s)");
    const manifest = await loadFrozenFile(join(root, FROZEN_FILE));
    expect(await collectViolations(root, manifest)).toEqual([]);
  });

  test("--staged on a clean baseline reports no drift and does not exit", async () => {
    let io = captureIo();
    await runFrozenHook(argv("--add", KEY));
    vi.restoreAllMocks();
    io = captureIo();
    await runFrozenHook(argv("--staged"));
    expect(io.exit).not.toHaveBeenCalled();
    expect(io.out.join("")).toContain("no frozen-interface drift");
  });

  test("--all on drifted source prints violations and exits 1", async () => {
    let io = captureIo();
    await runFrozenHook(argv("--add", KEY));
    vi.restoreAllMocks();
    await writeSource(SRC.replace("write() {}", "write(opts) {}"));
    io = captureIo();
    await runFrozenHook(argv("--all"));
    expect(io.exit).toHaveBeenCalledWith(1);
    expect(io.err.join("")).toContain("changed write: () → (opts)");
  });

  test("an unknown mode prints usage and exits 2", async () => {
    const { err, exit } = captureIo();
    await runFrozenHook(argv("--bogus"));
    expect(exit).toHaveBeenCalledWith(2);
    expect(err.join("")).toContain("audit every frozen type");
  });

  test("the thin main() wrapper delegates to runFrozenHook", async () => {
    const { exit } = captureIo();
    await main(argv("--bogus"));
    expect(exit).toHaveBeenCalledWith(2);
  });
});

describe("frozen-interfaces manifest edge cases", () => {
  let root;
  const writeSource = (body) => writeFile(join(root, REL), body, "utf8");

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "frozen-edge-"));
    await mkdir(join(root, "scripts/codegen/lib"), { recursive: true });
    await writeSource(SRC);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("a scopeless entry defaults to all scopes when diffing", async () => {
    // build a baseline, then drop the `scope` key so entryViolation falls back
    // to ALL_SCOPES and still catches an added constructor arg.
    const baseline = await addTarget(root, {}, { key: KEY, scopeRaw: "" });
    const scopeless = { [KEY]: { fingerprint: baseline[KEY].fingerprint } };
    await writeSource(
      SRC.replace("EmitPlan {", "EmitPlan {\n  constructor(x) {}"),
    );
    const violations = await collectViolations(root, scopeless);
    expect(violations[0].detail).toContain("constructor");
  });

  test("refreshManifest defaults a scopeless entry to all scopes", async () => {
    const scopeless = { [KEY]: {} };
    const refreshed = await refreshManifest(root, scopeless);
    expect(refreshed[KEY].scope).toEqual([
      "heritage",
      "constructor",
      "members",
    ]);
  });

  test("a manifest entry with no fingerprint is flagged as un-baselined", async () => {
    const manifest = { [KEY]: { scope: ["members"] } };
    const violations = await collectViolations(root, manifest);
    expect(violations[0].detail).toContain("has no baseline yet");
  });

  test("a target whose file is missing is reported as a not-found violation", async () => {
    const missingKey = "scripts/codegen/lib/gone.mjs#Ghost";
    const violations = await collectViolations(root, {
      [missingKey]: { fingerprint: {}, scope: ["members"] },
    });
    expect(violations[0].detail).toContain('frozen type "Ghost" not found');
  });

  test("a directory in place of the source file resolves to a not-found violation", async () => {
    const dirKey = "scripts/codegen/lib#Dir";
    const violations = await collectViolations(root, {
      [dirKey]: { fingerprint: {}, scope: ["members"] },
    });
    expect(violations[0].detail).toContain('frozen type "Dir" not found');
  });

  test("refreshManifest throws when a recorded target has vanished", async () => {
    const manifest = { "scripts/codegen/lib/gone.mjs#Ghost": { scope: [] } };
    await expect(refreshManifest(root, manifest)).rejects.toThrow(
      /frozen type "Ghost" not found/,
    );
  });

  test("addTarget throws when the named type is absent from the file", async () => {
    await expect(
      addTarget(root, {}, { key: `${REL}#Nope`, scopeRaw: "" }),
    ).rejects.toThrow(/frozen type "Nope" not found/);
  });

  test("loadFrozenFile parses an existing YAML manifest", async () => {
    const frozenPath = join(root, FROZEN_FILE);
    await writeFile(frozenPath, `${KEY}:\n  scope: [members]\n`, "utf8");
    const manifest = await loadFrozenFile(frozenPath);
    expect(manifest[KEY].scope).toEqual(["members"]);
  });

  test("loadFrozenFile treats an empty YAML document as an empty manifest", async () => {
    const frozenPath = join(root, FROZEN_FILE);
    await writeFile(frozenPath, "\n", "utf8");
    expect(await loadFrozenFile(frozenPath)).toEqual({});
  });

  // The source-read error handler only swallows ENOENT/EISDIR; any other read
  // error (here a null byte makes the path invalid) must propagate, not vanish.
  test("collectViolations rethrows a non-ENOENT read error rather than passing", async () => {
    await expect(
      collectViolations(root, {
        "bad\0path.mjs#X": { fingerprint: {}, scope: ["members"] },
      }),
    ).rejects.toThrow(/must be a string/);
  });

  test("loadFrozenFile rethrows a non-ENOENT read error", async () => {
    await expect(loadFrozenFile("bad\0path.yaml")).rejects.toThrow(
      /must be a string/,
    );
  });
});
