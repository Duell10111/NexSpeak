import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app holds an access token; never allow it to be framed (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(self), display-capture=(self), geolocation=()",
  },
];

const nextConfig: NextConfig = {
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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
