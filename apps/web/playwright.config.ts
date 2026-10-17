import { defineConfig, devices } from "@playwright/test"

const PORT = 3100
// Set by `npm run test:e2e:docker`: run the browsers in the Linux container from dev/docker-compose.yml.
const browserServer = process.env.E2E_BROWSER_WS

/**
 * End-to-end tests against the local Matrix + LiveKit stack in dev/docker-compose.yml.
 *   docker compose -f dev/docker-compose.yml --profile e2e up -d
 *   npm run test:e2e:docker   (browsers in Linux; required for audio on some macOS versions)
 *   npm run test:e2e          (browsers on this machine)
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // Tests share one homeserver and drive several browsers each; keep them sequential.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    connectOptions: browserServer ? { wsEndpoint: browserServer, exposeNetwork: "<loopback>" } : undefined,
    permissions: ["microphone", "camera"],
    // The app follows the browser language; the tests use the German UI.
    locale: "de-DE",
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && PORT=${PORT} node scripts/serve.mjs`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 300_000,
  },
})
