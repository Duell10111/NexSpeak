# Hosting the web app

The web app is a static export: `npm run build` produces `apps/web/out/`, which any web server can
serve. There is no Node server and no credentials on the server – the app talks directly to the
user's homeserver.

To run your own Matrix accounts, rooms and call services, see
[Hosting a Matrix homeserver](homeserver.md).

## Release downloads

Every [release](https://github.com/Duell10111/NexSpeak/releases) includes a
`NexSpeak-web-v<VERSION>.zip` alongside the desktop installers. Extract it into your web root;
`index.html`, the other pages and `_next/` are directly at the archive root. Configure your web
server as described below, including the security headers.

The same export is published as `ghcr.io/duell10111/nexspeak-web:<VERSION>` for Linux AMD64 and
ARM64. `latest` follows stable releases; `nightly` follows the newest nightly. Version tags omit
the leading `v`, for example `0.3.0` or `0.3.1-nightly.20261101.1`.

## Docker

```bash
docker run -d --name nexspeak-web --restart unless-stopped \
  -p 127.0.0.1:8080:8080 ghcr.io/duell10111/nexspeak-web:latest
```

Put an HTTPS reverse proxy in front of `http://127.0.0.1:8080`. The image serves only static files
using nginx as an unprivileged user. It includes the security headers, clean URLs, WebAssembly and
worker MIME types, and cache rules described below. No database or persistent volume is needed.

To update, pull the desired tag and recreate the container. `NEXT_PUBLIC_*` options are baked into
the export; passing them to `docker run` does not change the app. Release builds use the repository's
Actions variables `NEXT_PUBLIC_LIVEKIT_SERVICE_URL` and `NEXT_PUBLIC_KLIPY_API_KEY`.

For a local image with your own build-time configuration:

```bash
NEXT_PUBLIC_LIVEKIT_SERVICE_URL=https://matrix.example.org/livekit/jwt npm run build:docker:web
docker run --rm -p 127.0.0.1:8080:8080 nexspeak-web
```

The release workflows publish to GitHub Container Registry using `GITHUB_TOKEN` with
`packages: write`; no Docker Hub credentials are needed. After the first publication, the repository
owner must set the `nexspeak-web` package's visibility to **Public** in GitHub package settings to
allow anonymous pulls. The **Web** Actions workflow can also rebuild an existing stable release by
its tag.

## Build from source

```bash
npm run build      # → apps/web/out/
npm start          # local check: apps/web/scripts/serve.mjs on http://localhost:3000
```

## Requirements for the web server

1. **Security headers** from [`apps/web/security-headers.json`](https://github.com/Duell10111/NexSpeak/blob/main/apps/web/security-headers.json)
   on every response. The app holds an access token; without `X-Frame-Options` /
   `frame-ancestors` clickjacking would be possible. These headers cannot be set via `<meta>`.
2. **Clean URLs:** `/login` → `login.html`.
3. **MIME type `application/wasm`** for `.wasm` (Matrix Rust crypto), `text/javascript` for `.mjs`
   (LiveKit E2EE worker).
4. **Caching:** `/_next/static/` is hashed and may be cached for a year; everything else
   `no-cache`, so updates arrive immediately.
5. **HTTPS** – browsers only allow microphone, camera and screen sharing in secure contexts.

## Caddy

```caddyfile
nexspeak.example.org {
	root * /srv/nexspeak/out
	encode zstd gzip

	header {
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		X-Frame-Options "DENY"
		Content-Security-Policy "frame-ancestors 'none'"
		Permissions-Policy "microphone=(self), camera=(self), display-capture=(self), geolocation=()"
		-Server
	}

	@static path /_next/static/*
	header @static Cache-Control "public, max-age=31536000, immutable"
	header !@static Cache-Control "no-cache"

	try_files {path} {path}.html {path}/index.html
	file_server

	handle_errors {
		rewrite * /404.html
		file_server
	}
}
```

## nginx

```nginx
server {
    listen 443 ssl http2;
    server_name nexspeak.example.org;
    root /srv/nexspeak/out;

    # nginx' mime.types knows .wasm; add .mjs and .webmanifest if needed:
    types { text/javascript mjs; application/wasm wasm; application/manifest+json webmanifest; }
    include /etc/nginx/mime.types;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "DENY" always;
    add_header Content-Security-Policy "frame-ancestors 'none'" always;
    add_header Permissions-Policy "microphone=(self), camera=(self), display-capture=(self), geolocation=()" always;
    add_header Cache-Control "no-cache" always;

    location /_next/static/ {
        # add_header inside a location block replaces all inherited ones – so repeat them here.
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header X-Frame-Options "DENY" always;
        add_header Content-Security-Policy "frame-ancestors 'none'" always;
        add_header Permissions-Policy "microphone=(self), camera=(self), display-capture=(self), geolocation=()" always;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location / {
        try_files $uri $uri.html $uri/ =404;
    }

    error_page 404 /404.html;
}
```

When the headers in `security-headers.json` change, update these examples as well.

## Build-time configuration

`NEXT_PUBLIC_LIVEKIT_SERVICE_URL` (see `apps/web/.env.example`) is baked in at build time. Other
values require a new build. A relative path such as `/livekit-jwt` is resolved against the address
the web app is served from (browser only; the desktop app needs an absolute URL).

`NEXT_PUBLIC_KLIPY_API_KEY` enables the GIF picker. Create a key in the
[KLIPY partner dashboard](https://partner.klipy.com). It is a public client key that every browser
receives, so it does not need to be kept secret. Without it, the GIF button is hidden; received GIFs
still play. Users must turn on GIF search before NexSpeak contacts KLIPY.

## Planned voice moderation

Server mute, call-only disconnect and moving participants are not available yet. Their server
requirements and the pending companion-service decision are documented in
[Voice moderation: implementation prerequisites](voice-moderation-design.md).
