import { defineConfig } from "@playwright/test"

/**
 * End-to-end tests of the desktop app against the local stack in dev/docker-compose.yml.
 * They start the real Electron app with the static web build (npm run test:e2e:desktop).
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "../web/e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
})
