import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ?? "3100";

export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 45_000 },
  // Tests that sign real transactions share testnet accounts, so they run in order.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: `npx next start -p ${PORT}`, port: Number(PORT), reuseExistingServer: true, timeout: 60_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
