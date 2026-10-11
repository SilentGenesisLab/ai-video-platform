import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "browser.spec.ts",
  timeout: 60000,
  use: {
    viewport: { width: 1440, height: 1000 },
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
