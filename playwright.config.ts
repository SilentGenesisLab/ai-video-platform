import { defineConfig } from "@playwright/test";
import { config } from "dotenv";
config({ path: process.env.TEST_ENV_FILE || ".env", quiet: true });
export default defineConfig({
  testDir: "./tests",
  testMatch: /(?:browser|workflow)\.spec\.ts/,
  timeout: 90000,
  workers: 1,
  expect: { timeout: 10000 },
  use: {
    actionTimeout: 15000,
    navigationTimeout: 30000,
    baseURL: process.env.APP_URL || "http://127.0.0.1:3000",
    viewport: { width: 1440, height: 1000 },
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
