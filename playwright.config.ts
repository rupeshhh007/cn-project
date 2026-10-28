import { defineConfig } from "@playwright/test";

const hostedURL = process.env.HOPNET_TEST_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: hostedURL ?? "http://127.0.0.1:4173",
    channel: "chrome",
    trace: "retain-on-failure"
  },
  webServer: hostedURL ? undefined : {
    command: "npm start",
    url: "http://127.0.0.1:4173/api/health",
    reuseExistingServer: true,
    timeout: 60_000
  }
});
