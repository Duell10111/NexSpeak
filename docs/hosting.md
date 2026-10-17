# Hosting the web app

The web app is a static export: `npm run build` produces `apps/web/out/`, which any web server can
serve. There is no Node server and no credentials on the server – the app talks directly to the
user's homeserver.

```bash
npm run build      # → apps/web/out/
npm start          # local check: apps/web/scripts/serve.mjs on http://localhost:3000
```

## Requirements for the web server

1. **Security headers** from [`apps/web/security-headers.json`](../apps/web/security-headers.json)
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

    # nginx' mime.types knows .wasm; add .mjs if needed:
    types { text/javascript mjs; application/wasm wasm; }
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
values require a new build.
