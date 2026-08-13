import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./fixtures";

/**
 * One shared sandbox + one served panel for the whole run (built and started by
 * global-setup), so the suite runs serially against a single set of fired-hook
 * logs. No `webServer` here on purpose: serve must open the DBs only after
 * global-setup has seeded them and fired the hooks, so global-setup starts it.
 */
export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    ...devices["Desktop Chrome"],
  },
});
