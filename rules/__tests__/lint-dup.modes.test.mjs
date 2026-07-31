import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { main } from "../lint-dup/check.mjs";
import {
  cleanupTmp,
  commitAllIn,
  gitIn,
  makeTempGitRepo,
  markCurrentAsOriginMain,
  mockProcessIo,
} from "./test-helpers.mjs";

// A ≥5-line, ≥50-token block jscpd flags when it appears twice.
const DUP_BLOCK = `export function computeInvoiceTotalsForCustomer(lineItems, taxRate) {
  let runningSubtotal = 0;
  for (const currentLineItem of lineItems) {
    runningSubtotal += currentLineItem.quantity * currentLineItem.unitPrice;
  }
  const computedTaxAmount = runningSubtotal * taxRate;
  const grandTotalWithTax = runningSubtotal + computedTaxAmount;
  return { runningSubtotal, computedTaxAmount, grandTotalWithTax };
}`;

const SECOND_COPY = DUP_BLOCK.replace(
  "computeInvoiceTotalsForCustomer",
  "computeInvoiceTotalsForVendor",
);

describe("lint-dup / main dispatch (in-process, real jscpd)", () => {
  let repo;
  let io;
  let cwd;

  beforeEach(async () => {
    repo = await makeTempGitRepo("lint-dup-modes-");
    cwd = process.cwd();
    process.chdir(repo);
    io = mockProcessIo();
  });

  afterEach(async () => {
    io.restore();
    process.chdir(cwd);
    await cleanupTmp(repo);
  });

  async function seedTwoCopies() {
    await writeFile(join(repo, "a.mjs"), `${DUP_BLOCK}\n`);
    await writeFile(join(repo, "b.mjs"), `${SECOND_COPY}\n`);
  }

  test("--all lists duplicate pairs report-only and exits 0", async () => {
    await seedTwoCopies();
    await commitAllIn(repo, "two copies");

    await main(["node", "s", "--all"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    const out = io.text(io.stdoutSpy);
    expect(out).toMatch(/a\.mjs:.* <-> .*b\.mjs/);
    expect(out).toContain("duplicate block(s)");
  });

  test("--all with CO_JSON emits one JSON line of duplicate-code violations", async () => {
    await seedTwoCopies();
    await commitAllIn(repo, "two copies");

    process.env.CO_JSON = "1";
    try {
      await main(["node", "s", "--all"]);
    } finally {
      delete process.env.CO_JSON;
    }
    expect(io.exitSpy).not.toHaveBeenCalled();
    const lines = io.text(io.stdoutSpy).split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const violations = JSON.parse(lines[0]).violations;
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].kind).toMatch(/duplicate code/);
  });

  // A frontend/ directory triggers the separate frontend-only jscpd scan (the
  // browser build can't import server code, so cross-boundary pairs are mirrors).
  test("--all scans frontend/ separately and flags within-frontend duplication", async () => {
    await mkdir(join(repo, "frontend"), { recursive: true });
    await writeFile(join(repo, "frontend", "x.mjs"), `${DUP_BLOCK}\n`);
    await writeFile(join(repo, "frontend", "y.mjs"), `${SECOND_COPY}\n`);
    // A substantial root-level file keeps the everything-else `.` scan non-empty
    // (jscpd writes no report when a scan has no eligible token content).
    await writeFile(
      join(repo, "server.mjs"),
      `${DUP_BLOCK.replace("computeInvoiceTotalsForCustomer", "serverSideTotals")}\n`,
    );
    await commitAllIn(repo, "frontend with duplication + a server file");

    await main(["node", "s", "--all"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    const out = io.text(io.stdoutSpy);
    expect(out).toMatch(/frontend\/x\.mjs.* <-> .*frontend\/y\.mjs/);
  });

  test("--all over a repo with no duplication prints the clean line", async () => {
    await writeFile(join(repo, "solo.mjs"), `${DUP_BLOCK}\n`);
    await commitAllIn(repo, "single copy");

    await main(["node", "s", "--all"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("no duplication found");
  });

  test("--files with duplication in a listed file writes to stderr and exits 1", async () => {
    await seedTwoCopies();
    await commitAllIn(repo, "two copies");

    await expect(main(["node", "s", "--files", "a.mjs"])).rejects.toThrow(
      /__exit__:1/,
    );
    expect(io.text(io.stderrSpy)).toMatch(/a\.mjs/);
  });

  // Passing only the OTHER member of the pair exercises the second-side arm of
  // the targets.has(first) || targets.has(second) filter.
  test("--files on the second member of a pair still reports the clone (exit 1)", async () => {
    await seedTwoCopies();
    await commitAllIn(repo, "two copies");

    await expect(main(["node", "s", "--files", "b.mjs"])).rejects.toThrow(
      /__exit__:1/,
    );
    expect(io.text(io.stderrSpy)).toMatch(/b\.mjs/);
  });

  test("--files with no duplication among listed files prints the clean line", async () => {
    await writeFile(join(repo, "solo.mjs"), `${DUP_BLOCK}\n`);
    await commitAllIn(repo, "single copy");

    await main(["node", "s", "--files", "solo.mjs"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain(
      "no duplication in the given files",
    );
  });

  test("--files with only non-code paths prints the no-code-files line", async () => {
    await writeFile(join(repo, "readme.md"), "# hi\n");
    await commitAllIn(repo, "docs");

    await main(["node", "s", "--files", "readme.md"]);
    expect(io.text(io.stdoutSpy)).toContain("no code files given");
  });

  test("--files with CO_JSON emits one JSON line of duplicate-code violations", async () => {
    await seedTwoCopies();
    await commitAllIn(repo, "two copies");

    process.env.CO_JSON = "1";
    try {
      await main(["node", "s", "--files", "a.mjs"]);
    } finally {
      delete process.env.CO_JSON;
    }
    expect(io.exitSpy).not.toHaveBeenCalled();
    const lines = io.text(io.stdoutSpy).split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).violations.length).toBeGreaterThan(0);
  });

  test("--files with CO_JSON and no code files emits an empty JSON line", async () => {
    await writeFile(join(repo, "readme.md"), "# hi\n");
    await commitAllIn(repo, "docs");

    process.env.CO_JSON = "1";
    try {
      await main(["node", "s", "--files", "readme.md"]);
    } finally {
      delete process.env.CO_JSON;
    }
    expect(JSON.parse(io.text(io.stdoutSpy).trim())).toEqual({
      violations: [],
    });
  });

  test("--staged with a newly-staged duplicate block flags it and exits 1", async () => {
    await seedTwoCopies();
    await gitIn(repo, ["add", "-A"]);

    await expect(main(["node", "s", "--staged"])).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toContain("newly-introduced duplicate block");
  });

  test("--staged with no code files prints the no-staged-code line", async () => {
    await writeFile(join(repo, "readme.md"), "# hi\n");
    await gitIn(repo, ["add", "-A"]);

    await main(["node", "s", "--staged"]);
    expect(io.text(io.stdoutSpy)).toContain("no staged diff code files");
  });

  test("--staged where the only clone is import-only is NOT flagged", async () => {
    // Two modules repeating the same import list: a false positive jscpd would
    // match but selectNewClones drops via isImportOnlyBlock.
    // Identical import lists; a leading comment distinguishes the two modules so
    // jscpd's matched region is exactly the import block (nothing past it).
    const imports = `import { alphaOne, alphaTwo, alphaThree } from "./alpha.mjs";
import { bravoOne, bravoTwo, bravoThree } from "./bravo.mjs";
import { charlieOne, charlieTwo, charlieThree } from "./charlie.mjs";
import { deltaOne, deltaTwo, deltaThree } from "./delta.mjs";
import { echoOne, echoTwo, echoThree } from "./echo.mjs";
import { foxOne, foxTwo, foxThree } from "./foxtrot.mjs";
`;
    await writeFile(join(repo, "one.mjs"), `// module one\n${imports}`);
    await writeFile(join(repo, "two.mjs"), `// module two\n${imports}`);
    await gitIn(repo, ["add", "-A"]);

    await main(["node", "s", "--staged"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("no newly-introduced duplication");
  });

  test("--push skips when origin/main is absent", async () => {
    await seedTwoCopies();
    await commitAllIn(repo, "two copies, no origin ref");

    await main(["node", "s", "--push"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("origin/main not found");
  });

  // A push that introduces no new duplication runs ratchetGate to a clean finish,
  // so runPushMode returns normally (the non-skip, non-throw path).
  test("--push with no new duplication returns cleanly (exit 0)", async () => {
    await writeFile(join(repo, "a.mjs"), `${DUP_BLOCK}\n`);
    await commitAllIn(repo, "baseline single copy");
    await markCurrentAsOriginMain(repo);
    await writeFile(
      join(repo, "unrelated.mjs"),
      `export const version = "2.0.0";\n`,
    );
    await commitAllIn(repo, "add an unrelated non-duplicate file");

    await main(["node", "s", "--push"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("no newly-introduced duplication");
  });

  test("--push flags a genuinely-new duplicate block and exits 1", async () => {
    await writeFile(join(repo, "a.mjs"), `${DUP_BLOCK}\n`);
    await commitAllIn(repo, "baseline single copy");
    await markCurrentAsOriginMain(repo);
    await writeFile(join(repo, "b.mjs"), `${SECOND_COPY}\n`);
    await commitAllIn(repo, "add a second copy");

    await expect(main(["node", "s", "--push"])).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toContain("newly-introduced duplicate block");
  });

  test("no mode prints usage and exits 2", async () => {
    await expect(main(["node", "s"])).rejects.toThrow(/__exit__:2/);
    expect(io.text(io.stderrSpy)).toContain("Usage:");
  });
});
