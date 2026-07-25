import { rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  commitAllIn,
  gitIn,
  makeTempGitRepo,
  markCurrentAsOriginMain,
  runHookPush,
} from "./test-helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LINT_DUP = resolve(HERE, "..", "lint-dup.mjs");

/** A ≥5-line, ≥50-token block that jscpd will flag when it appears twice. */
const DUP_BLOCK = `export function computeInvoiceTotalsForCustomer(lineItems, taxRate) {
  let runningSubtotal = 0;
  for (const currentLineItem of lineItems) {
    runningSubtotal += currentLineItem.quantity * currentLineItem.unitPrice;
  }
  const computedTaxAmount = runningSubtotal * taxRate;
  const grandTotalWithTax = runningSubtotal + computedTaxAmount;
  return { runningSubtotal, computedTaxAmount, grandTotalWithTax };
}`;

describe("lint-dup / --push ratchet is rename-aware", () => {
  let repo;

  beforeEach(async () => {
    repo = await makeTempGitRepo("lint-dup-rename-");
  });

  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  test("pure git-mv of a file with pre-existing internal duplication is NOT flagged as newly-introduced", async () => {
    const fileBody = `${DUP_BLOCK}\n\nconst separator = "x";\n\n${DUP_BLOCK.replace("computeInvoiceTotalsForCustomer", "computeInvoiceTotalsForVendor")}\n`;
    await writeFile(join(repo, "billing.mjs"), fileBody);
    await commitAllIn(repo, "baseline: file with two duplicate blocks");
    await markCurrentAsOriginMain(repo);

    await gitIn(repo, ["mv", "billing.mjs", "invoicing.mjs"]);
    await commitAllIn(
      repo,
      "rename billing.mjs -> invoicing.mjs, no content change",
    );

    const result = await runHookPush(LINT_DUP, repo);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("no newly-introduced duplication");
    expect(result.stderr).not.toMatch(/duplicate block/);
  });

  test("rename that ALSO adds a genuinely-new duplicate block IS flagged", async () => {
    await writeFile(
      join(repo, "billing.mjs"),
      `${DUP_BLOCK}\n\nexport const version = "1.0.0";\n`,
    );
    await commitAllIn(repo, "baseline: single block, no duplication");
    await markCurrentAsOriginMain(repo);

    const renamedWithNewClone = `${DUP_BLOCK}\n\nexport const version = "1.0.0";\n\n${DUP_BLOCK.replace("computeInvoiceTotalsForCustomer", "computeInvoiceTotalsForVendor")}\n`;
    await gitIn(repo, ["mv", "billing.mjs", "invoicing.mjs"]);
    await writeFile(join(repo, "invoicing.mjs"), renamedWithNewClone);
    await commitAllIn(
      repo,
      "rename billing.mjs -> invoicing.mjs and add a duplicate block",
    );

    const result = await runHookPush(LINT_DUP, repo);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("newly-introduced duplicate block");
    expect(result.stderr).toContain("invoicing.mjs");
  });
});
