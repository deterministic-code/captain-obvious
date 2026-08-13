import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { scaffoldConfig } from "../scaffold-config.mjs";

const SCRATCH = tmpdir();

const CLAUDE_HOOKS = [
  {
    event: "PreToolUse",
    matcher: "Edit|Write|NotebookEdit|Bash",
    hook: "pre-tool-guard",
    timeout: 5,
  },
  { event: "Stop", hook: "stop-guard", timeout: 15 },
];

async function readConfig(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

// readline/promises only captures input written while a question is pending, so
// answer each prompt reactively as its text is written to `output`.
function autoRespond(input, output, { mode, hooks, gitignore = "" }) {
  output.on("data", (chunk) => {
    const text = chunk.toString();
    if (text.includes("Registry DB location")) {
      input.write(`${mode}\n`);
    } else if (text.includes("Wire git")) {
      input.write(`${hooks}\n`);
    } else if (text.includes(".gitignore")) {
      input.write(`${gitignore}\n`);
    }
  });
}

describe("scaffold-config / scaffoldConfig", () => {
  let target;

  beforeEach(async () => {
    target = await mkdtemp(join(SCRATCH, "scaffold-"));
  });

  afterEach(async () => {
    await rm(target, { recursive: true, force: true });
  });

  test("no-ops when config already exists", async () => {
    const configPath = join(target, "captain-obvious.config.json");
    const original = { custom: true, nested: { key: "value" } };
    await writeFile(configPath, JSON.stringify(original), "utf8");

    const result = await scaffoldConfig({ target, isTTY: false });

    expect(result.created).toBe(false);
    expect(result.path).toBe(configPath);
    expect(await readConfig(configPath)).toEqual(original);
  });

  test("creates config with all defaults when non-interactive", async () => {
    const result = await scaffoldConfig({ target, isTTY: false });

    expect(result).toEqual({
      path: join(target, "captain-obvious.config.json"),
      created: true,
    });
    const written = await readConfig(result.path);
    expect(written).toEqual({
      gitignore: true,
      gitHooks: {},
      claudeHooks: CLAUDE_HOOKS,
    });
    expect(written.mode).toBeUndefined();
  });

  test("interactive: empty answers take the defaults", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    autoRespond(input, output, { mode: "", hooks: "" });
    const result = await scaffoldConfig({ target, input, output, isTTY: true });

    expect(await readConfig(result.path)).toEqual({
      gitignore: true,
      gitHooks: {},
      claudeHooks: CLAUDE_HOOKS,
    });
  });

  test("interactive: 'n' at the .gitignore prompt opts out", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    autoRespond(input, output, { mode: "", hooks: "", gitignore: "n" });
    const result = await scaffoldConfig({ target, input, output, isTTY: true });

    expect(await readConfig(result.path)).toEqual({
      gitignore: false,
      gitHooks: {},
      claudeHooks: CLAUDE_HOOKS,
    });
  });

  test("interactive: 'global' + 'n' opts into global mode and no hooks", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    autoRespond(input, output, { mode: "global", hooks: "no" });
    const result = await scaffoldConfig({ target, input, output, isTTY: true });

    expect(await readConfig(result.path)).toEqual({
      mode: "global",
      gitHooks: { enabled: false },
    });
  });

  test("yes: skips every prompt even on a TTY", async () => {
    const input = new PassThrough();
    input.write("global\n");
    const result = await scaffoldConfig({
      target,
      input,
      output: new PassThrough(),
      isTTY: true,
      yes: true,
    });

    expect(await readConfig(result.path)).toEqual({
      gitignore: true,
      gitHooks: {},
      claudeHooks: CLAUDE_HOOKS,
    });
  });

  test("defaults: pinned gitignore=false is written without prompting", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    autoRespond(input, output, { mode: "", hooks: "" });
    const result = await scaffoldConfig({
      target,
      input,
      output,
      isTTY: true,
      defaults: { gitignore: false },
    });

    expect(await readConfig(result.path)).toEqual({
      gitignore: false,
      gitHooks: {},
      claudeHooks: CLAUDE_HOOKS,
    });
  });

  test("defaults: pinned mode/wireHooks are never prompted for", async () => {
    const input = new PassThrough();
    const result = await scaffoldConfig({
      target,
      input,
      output: new PassThrough(),
      isTTY: true,
      defaults: { mode: "global", wireHooks: false },
    });

    expect(await readConfig(result.path)).toEqual({
      mode: "global",
      gitHooks: { enabled: false },
    });
  });

  test("writes valid JSON with 2-space indentation", async () => {
    const { path } = await scaffoldConfig({ target, isTTY: false });
    const content = await readFile(path, "utf8");
    expect(content).toContain("  ");
    expect(() => JSON.parse(content)).not.toThrow();
  });
});
