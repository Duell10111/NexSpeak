import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
// Single source for the dev server, scripts/serve.mjs, the hosting examples in docs/hosting.md
// and the desktop app. The app holds an access token; it must never be framed (clickjacking).
import securityHeaders from "./security-headers.json";

export default function config(phase: string): NextConfig {
  return {
    // A static export: the app is purely client-side, so any static host (and the desktop app)
    // can serve it without a Node server.
    output: "export",
    // The React Compiler memoizes on object identity, but matrix-js-sdk objects (Room, GroupCall, ...)
    // are mutated in place. Keep it off so reads from SDK objects never go stale.
    reactCompiler: false,
    // matrix-js-sdk refuses to be evaluated twice per process ("Multiple matrix-js-sdk entrypoints").
    // The dev server bundles it once per route, so server rendering failed with a 500; loading it
    // through Node's module cache keeps it to a single instance.
    serverExternalPackages: ["matrix-js-sdk"],
    // Workspace packages ship TypeScript sources.
    transpilePackages: ["@nexspeak/core", "@nexspeak/i18n"],
    poweredByHeader: false,
    // A static export cannot send headers; the host does that in production. The dev server sends
    // the same ones so problems show up early.
    ...(phase === PHASE_DEVELOPMENT_SERVER && {
      async headers() {
        const headers = Object.entries(securityHeaders).map(([key, value]) => ({ key, value }));
        return [{ source: "/:path*", headers }];
      },
    }),
  };
}
