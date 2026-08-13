import { expect, type Locator, type Page, test } from "@playwright/test";
import { BASE_URL, DISABLED_RULES } from "./fixtures";

/** Open the panel, click the injected Activity tab, wait for the feed to populate. */
async function openFeed(page: Page) {
  await page.goto("/");
  await page.locator("a.co-activity-tab").click();
  const feed = page.locator("#co-act-feed");
  await feed.locator(".co-act-row").first().waitFor();
  return feed;
}

/**
 * Feed rows whose detail names a `stage/slug`. The runner brackets every run in
 * run.start + run.end, so a rule that ran shows at least two such rows — asserting
 * the pair (count ≥ 2) proves the logging guarantee from the real hook to the panel.
 */
function runRows(page: Page, stageSlug: string): Locator {
  return page.locator("#co-act-feed .co-act-row", { hasText: stageSlug });
}

test.describe("hooks fire → log through the runner → show in the panel", () => {
  test.beforeEach(async ({ page }) => {
    await openFeed(page);
  });

  test("git pre-commit dispatch is logged", async ({ page }) => {
    expect(
      await runRows(page, "pre-commit/lint-prettier").count(),
    ).toBeGreaterThanOrEqual(2);
  });

  test("git pre-push dispatch is logged", async ({ page }) => {
    expect(
      await runRows(page, "pre-push/gov-no-push-to-main").count(),
    ).toBeGreaterThanOrEqual(2);
  });

  test("Claude PreToolUse tool guards are logged", async ({ page }) => {
    expect(
      await runRows(page, "tool/lint-protected-paths").count(),
    ).toBeGreaterThanOrEqual(2);
    expect(
      await runRows(page, "tool/gov-no-push-to-main").count(),
    ).toBeGreaterThanOrEqual(2);
  });

  test("Claude Stop guard is logged and blocks on unmerged work", async ({
    page,
  }) => {
    await expect(page.locator("#co-act-feed")).toContainText(
      "stop/gov-merge-before-stop — failure",
    );
  });

  test("each Claude write is auto-Prettiered on write (PostToolUse), logged", async ({
    page,
  }) => {
    // tool-fix runs Prettier --write on each messy file Claude writes, logged at `fix`.
    await expect(page.locator("#co-act-feed")).toContainText(
      "fix/lint-prettier — 1 file(s) fixed",
    );
  });

  test("the duplicated function is flagged by the dup ratchet at pre-push", async ({
    page,
  }) => {
    // The identical `summarize` in both files is newly-introduced vs origin/main.
    const feed = page.locator("#co-act-feed");
    await expect(feed).toContainText(
      /pre-push\/lint-dup(-fn)? — \d+ issue\(s\) found/,
    );
    await expect(
      feed
        .locator(".co-act-row", { hasText: "lint-dup-fn" })
        .filter({ hasText: "failure" })
        .first(),
    ).toBeVisible();
  });

  test("both run.start and run.end log rows render", async ({ page }) => {
    const feed = page.locator("#co-act-feed");
    await expect(
      feed.locator(".co-act-key", { hasText: "run.start" }).first(),
    ).toBeVisible();
    await expect(
      feed.locator(".co-act-key", { hasText: "run.end" }).first(),
    ).toBeVisible();
  });

  test("offline-incompatible governance rules never ran", async ({ page }) => {
    // A `rule.disabled` mention is fine; a run is `<stage>/<slug>`, so a slash marks one.
    const feed = page.locator("#co-act-feed");
    for (const slug of DISABLED_RULES) {
      await expect(
        feed.locator(".co-act-row", { hasText: `/${slug}` }),
      ).toHaveCount(0);
    }
  });
});

test("the feed API corroborates every fired stage", async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/activity/feed?last=7d`);
  expect(res.ok()).toBeTruthy();
  const events: { source: string; key: string; detail: string }[] =
    await res.json();

  const logDetails = events
    .filter((e) => e.source === "log" && e.key.startsWith("run."))
    .map((e) => e.detail);
  // Every hook stage fired, including the PostToolUse Prettier `fix`.
  for (const stage of ["pre-commit/", "pre-push/", "tool/", "stop/", "fix/"]) {
    expect(logDetails.some((d) => d.startsWith(stage))).toBeTruthy();
  }
  // The lint tools actually found something on Claude's messy, duplicated files.
  expect(
    logDetails.some((d) => /^fix\/lint-prettier — \d+ file/.test(d)),
  ).toBeTruthy();
  expect(
    logDetails.some((d) => /^pre-push\/lint-dup(-fn)? — \d+ issue/.test(d)),
  ).toBeTruthy();
  expect(events.some((e) => e.key === "run.start")).toBeTruthy();
  expect(events.some((e) => e.key === "run.end")).toBeTruthy();
});
