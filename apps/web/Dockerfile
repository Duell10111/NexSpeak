# syntax=docker/dockerfile:1

# Generate nginx directives from the same headers used by the app and desktop client.
# This stage always runs natively, even when packaging the export for another architecture.
FROM --platform=$BUILDPLATFORM node:24-alpine AS headers
WORKDIR /headers
COPY security-headers.json .
RUN node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const headers = JSON.parse(readFileSync("security-headers.json", "utf8"));
writeFileSync("security-headers.conf", Object.entries(headers)
  .map(([name, value]) => `add_header ${name} ${JSON.stringify(value)} always;`)
  .join("\n") + "\n");
JS

FROM ghcr.io/nginx/nginx-unprivileged:stable-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=headers /headers/security-headers.conf /etc/nginx/security-headers.conf
COPY out/ /usr/share/nginx/html/
EXPOSE 8080
