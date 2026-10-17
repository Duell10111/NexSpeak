# Hosting der Web-App

Die Web-App ist ein statischer Export: `npm run build` erzeugt `apps/web/out/`, das jeder
Webserver ausliefern kann. Es gibt keinen Node-Server und keine Zugangsdaten auf dem Server –
die App spricht direkt mit dem Homeserver des Nutzers.

```bash
npm run build      # → apps/web/out/
npm start          # lokale Prüfung: apps/web/scripts/serve.mjs auf http://localhost:3000
```

## Anforderungen an den Webserver

1. **Security-Header** aus [`apps/web/security-headers.json`](../apps/web/security-headers.json)
   bei jeder Antwort senden. Die App hält ein Access-Token; ohne `X-Frame-Options` /
   `frame-ancestors` wäre Clickjacking möglich. Diese Header lassen sich nicht per `<meta>` setzen.
2. **Saubere URLs:** `/login` → `login.html`.
3. **MIME-Typ `application/wasm`** für `.wasm` (Matrix-Rust-Crypto), `text/javascript` für `.mjs`
   (LiveKit-E2EE-Worker).
4. **Caching:** `/_next/static/` ist gehasht und darf ein Jahr gecacht werden, alles andere
   `no-cache`, damit Updates sofort ankommen.
5. **HTTPS** – Mikrofon, Kamera und Bildschirmfreigabe gibt es im Browser nur in sicheren Kontexten.

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

    # nginx' mime.types kennt .wasm; .mjs ggf. ergänzen:
    types { text/javascript mjs; application/wasm wasm; }
    include /etc/nginx/mime.types;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "DENY" always;
    add_header Content-Security-Policy "frame-ancestors 'none'" always;
    add_header Permissions-Policy "microphone=(self), camera=(self), display-capture=(self), geolocation=()" always;
    add_header Cache-Control "no-cache" always;

    location /_next/static/ {
        # add_header in einem location-Block ersetzt alle geerbten – deshalb hier wiederholen.
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

Werden die Header in `security-headers.json` geändert, müssen diese Beispiele mitgezogen werden.

## Konfiguration beim Build

`NEXT_PUBLIC_LIVEKIT_SERVICE_URL` (siehe `apps/web/.env.example`) wird beim Build fest
eingebaut. Für andere Werte muss neu gebaut werden.
