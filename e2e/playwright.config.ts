import { defineConfig } from "@playwright/test";
import { UI_URL } from "./scripts/env.js";

/**
 * End-to-end suite against a real server + Vite UI + MongoDB. `scripts/stack.ts`
 * brings the whole stack up (MongoDB from MANGO_E2E_MONGO_URL, or an in-process
 * mongodb-memory-server), so `pnpm e2e` works with nothing else running.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  // Tests reset the demo database between runs, so they must not interleave.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: UI_URL,
    // The tests drive Monaco with ControlOrMeta shortcuts, which only line up
    // when Monaco sees the host platform — so no device descriptor here (the
    // "Desktop Chrome" one carries a Windows user agent).
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1400, height: 900 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "pnpm exec tsx scripts/stack.ts",
    // Through the Vite proxy, so this only answers once both are up.
    url: `${UI_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
