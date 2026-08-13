import { expect, type Page, test } from "@playwright/test";
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
 * The runner brackets every run in run.start + run.end, so a rule that ran shows
 * (at least) two feed rows whose detail names its `stage/slug`. Asserting the pair
 * — not just presence — is the point: it proves the logging guarantee end to end,
 * from the real hook through the audit DB to the rendered panel.
 */
async function expectRunPair(page: Page, stageSlug: string) {
  const rows = page.locator("#co-act-feed .co-act-row", { hasText: stageSlug });
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
}

test.describe("hooks fire → log through the runner → show in the panel", () => {
  test.beforeEach(async ({ page }) => {
    await openFeed(page);
  });

  test("git pre-commit dispatch is logged", async ({ page }) => {
    await expectRunPair(page, "pre-commit/lint-prettier");
  });

  test("git pre-push dispatch is logged", async ({ page }) => {
    await expectRunPair(page, "pre-push/gov-no-push-to-main");
  });

  test("Claude PreToolUse tool guards are logged", async ({ page }) => {
    await expectRunPair(page, "tool/lint-protected-paths");
    await expectRunPair(page, "tool/gov-no-push-to-main");
  });

  test("Claude Stop guard is logged and blocks on unmerged work", async ({
    page,
  }) => {
    await expectRunPair(page, "stop/gov-merge-before-stop");
    await expect(page.locator("#co-act-feed")).toContainText(
      "stop/gov-merge-before-stop — failure",
    );
  });

  test("both run.start and run.end log rows render", async ({ page }) => {
    const feed = page.locator("#co-act-feed");
    await expect(feed.locator(".co-act-key", { hasText: "run.start" }).first()).toBeVisible();
    await expect(feed.locator(".co-act-key", { hasText: "run.end" }).first()).toBeVisible();
  });

  test("offline-incompatible governance rules never ran", async ({ page }) => {
    // These slugs still appear in the setup's `rule.disabled` audit rows — that's
    // expected. What must be absent is any actual run: a `run.*` row's detail is
    // `<stage>/<slug>`, so a leading slash distinguishes a run from a mention.
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
  for (const stage of ["pre-commit/", "pre-push/", "tool/", "stop/"]) {
    expect(logDetails.some((d) => d.startsWith(stage))).toBeTruthy();
  }
  expect(events.some((e) => e.key === "run.start")).toBeTruthy();
  expect(events.some((e) => e.key === "run.end")).toBeTruthy();
});
