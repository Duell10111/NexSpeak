import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { settings: { next: { rootDir: "apps/web/" } } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    // Copied at build time (apps/web/scripts/copy-public-assets.mjs).
    "apps/web/public/livekit-e2ee-worker.mjs",
    "apps/web/public/audio-processing/**",
    "**/test-results/**",
    "**/playwright-report/**",
    "dev/.data/**",
    // Compiled and packaged desktop app.
    "apps/desktop/dist/**",
    "apps/desktop/release/**",
  ]),
]);

export default eslintConfig;
