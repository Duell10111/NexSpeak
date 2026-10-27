# Hosting a Matrix homeserver

Your homeserver stores Matrix accounts, rooms and messages. This guide sets up **Synapse** with
**PostgreSQL** and **Caddy** on a Linux server using Docker Compose. You can then sign in from the
NexSpeak desktop app or any hosted NexSpeak web app. Hosting the client yourself is a separate,
optional step: see [Hosting the web app](hosting.md).

Start with chat, then add the [MatrixRTC backend](#add-voice-video-and-screen-sharing) for voice,
video and screen sharing. The examples are for a new installation on one server, with password
sign-in and accounts created by the administrator.

## Before you start

You need a Linux server with Docker Engine and the Compose plugin, SSH access, persistent storage
and a domain you control. Follow Docker's [Engine installation guide](https://docs.docker.com/engine/install/)
for your distribution. Run the commands below on that server from the same working directory;
use `sudo` for Docker if your installation requires it.

Replace these example names everywhere:

| Name | Purpose |
|---|---|
| `matrix.example.com` | Homeserver, account domain and client/federation API |
| `rtc.example.com` | MatrixRTC authorization service, if you add calls |
| `livekit.example.com` | LiveKit signalling, if you add calls |

Create DNS **A** records pointing to the server's public IPv4 address. Add **AAAA** records only if
IPv6 reaches the same services. For a server behind a router, forward the required ports as well;
a connection behind carrier-grade NAT needs another way to accept public connections.

| Public inbound port | Purpose |
|---|---|
| TCP 80 and 443 | Caddy's HTTPS setup, Matrix API and federation |
| TCP 7881 | Direct WebRTC media fallback, when adding LiveKit |
| UDP 7882 | WebRTC media, when adding LiveKit |

Allow these in both the host firewall and your provider's firewall. Keep SSH accessible. PostgreSQL,
Synapse's HTTP port and the call services' HTTP ports stay private. This example uses Linux host
networking for Caddy and LiveKit; it is not a Docker Desktop deployment.

:::{important}
Here, accounts will look like `@alice:matrix.example.com`. Synapse's **server name cannot be changed
after installation**. If you want `@alice:example.com`, choose that server name before generating
the configuration and set up discovery on `example.com` using the
[Synapse delegation guide](https://element-hq.github.io/synapse/latest/delegate.html).
The rest of this page assumes `matrix.example.com` is both the server name and API hostname.
:::

See [Synapse's installation instructions](https://element-hq.github.io/synapse/latest/setup/installation.html)
for the server-name decision and supported installation methods.

## 1. Create the deployment files

```bash
mkdir -p ~/nexspeak-matrix/synapse
cd ~/nexspeak-matrix
umask 077
openssl rand -hex 32
```

Save the generated value in a file named `.env`:

```text
POSTGRES_PASSWORD=REPLACE_WITH_THE_GENERATED_VALUE
```

Keep this password for the Synapse database configuration in the next step. The examples pin
Synapse to a release; check the [Synapse releases](https://github.com/element-hq/synapse/releases)
for newer stable releases and security updates before deploying.

Create `compose.yaml`:

```yaml
name: nexspeak-matrix

services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: synapse
      POSTGRES_DB: synapse
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      POSTGRES_INITDB_ARGS: --encoding=UTF8 --locale=C
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: [CMD-SHELL, pg_isready -U synapse -d synapse]
      interval: 10s
      timeout: 5s
      retries: 10

  synapse:
    image: ghcr.io/element-hq/synapse:v1.163.0
    restart: unless-stopped
    volumes:
      - ./synapse:/data
    ports:
      - 127.0.0.1:8008:8008
    depends_on:
      postgres:
        condition: service_healthy

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  postgres_data:
  caddy_data:
  caddy_config:
```

The database is initialized with UTF-8 and the `C` locale, as required by
[Synapse's PostgreSQL setup](https://element-hq.github.io/synapse/latest/postgres.html).
The [PostgreSQL image documentation](https://hub.docker.com/_/postgres) explains the initialization
variables: changing `.env` later does not change the password of an already initialized database.

## 2. Configure Synapse

Generate the initial configuration and signing key using the
[official Synapse image](https://github.com/element-hq/synapse/blob/develop/docker/README.md):

```bash
docker compose run --rm --no-deps \
  -e SYNAPSE_SERVER_NAME=matrix.example.com \
  -e SYNAPSE_REPORT_STATS=no \
  synapse generate
```

Edit `synapse/homeserver.yaml` (use `sudoedit` if the generated files belong to the container's
user). Replace the existing `listeners` and `database` sections and set the following options;
do not leave duplicate YAML keys. Enter the actual database password from `.env`: Synapse does
not expand `${POSTGRES_PASSWORD}` in this file.

```yaml
server_name: matrix.example.com
public_baseurl: https://matrix.example.com/
report_stats: false
enable_registration: false
max_upload_size: 100M

listeners:
  - port: 8008
    type: http
    tls: false
    bind_addresses: [0.0.0.0]
    x_forwarded: true
    resources:
      - names: [client, federation]
        compress: false

database:
  name: psycopg2
  args:
    user: synapse
    password: "REPLACE_WITH_THE_SAME_DATABASE_PASSWORD"
    dbname: synapse
    host: postgres
    port: 5432
    cp_min: 5
    cp_max: 10
```

Keep the generated signing-key path, media-store path, log configuration and random secrets.
Also keep the generated `registration_shared_secret`; the local account-creation command below
uses it. If your generated configuration has none, generate another independent random value
with `openssl rand -hex 32` and set `registration_shared_secret` to that value.

The listener accepts container-network traffic; only its host port is bound to loopback.
`x_forwarded` lets Synapse use Caddy's forwarded connection information. See the
[Synapse reverse-proxy instructions](https://element-hq.github.io/synapse/latest/reverse_proxy.html)
and [configuration reference](https://element-hq.github.io/synapse/latest/usage/configuration/config_documentation.html).

## 3. Set up HTTPS and discovery

Create `Caddyfile` beside `compose.yaml`:

```caddyfile
matrix.example.com {
    header /.well-known/matrix/* Content-Type application/json
    header /.well-known/matrix/client Access-Control-Allow-Origin *

    respond /.well-known/matrix/server `{"m.server":"matrix.example.com:443"}`
    respond /.well-known/matrix/client `{"m.homeserver":{"base_url":"https://matrix.example.com"}}`

    @matrix path /_matrix/* /_synapse/client/*
    handle @matrix {
        reverse_proxy 127.0.0.1:8008
    }
    handle {
        respond "Not found" 404
    }
}
```

This serves client discovery and delegates federation to port 443, so port 8448 is not needed.
The administrative `/_synapse/admin` API stays behind the local connection. With correct DNS and
reachable ports, [Caddy obtains and renews HTTPS certificates](https://caddyserver.com/docs/automatic-https).
Do not run a second web server on the same ports; if you already have a reverse proxy, adapt its
configuration instead of starting another one.

Validate and start the stack:

```bash
docker compose config --quiet
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
docker compose up -d
docker compose ps
docker compose logs --tail=100 synapse caddy
```

From another machine, check:

```bash
curl -fsS https://matrix.example.com/_matrix/client/versions
curl -fsS https://matrix.example.com/.well-known/matrix/client
curl -fsS https://matrix.example.com/.well-known/matrix/server
curl -fsS https://matrix.example.com/_matrix/federation/v1/version
```

Each should return JSON over trusted HTTPS. The first response contains `versions`, client
discovery points to your homeserver, and server discovery points to `matrix.example.com:443`.
The [Matrix federation tester](https://federationtester.matrix.org/) can help check public federation
discovery; also test exchanging messages with an account on another homeserver.

## 4. Create accounts and sign in

Create your first account interactively, so its password does not appear in the command line:

```bash
docker compose exec synapse register_new_matrix_user \
  -c /data/homeserver.yaml http://localhost:8008
```

Choose a username and password. Answer `yes` to the admin question only for your administrator
account; use ordinary accounts for daily use and other members. Run the command again to add
people. Public registration remains disabled. Keep the registration shared secret private: it
allows account creation, including administrators, independently of public registration.

In NexSpeak, enter `https://matrix.example.com` in **Homeserver** and sign in with the account
you just created. Open **Settings → Security** to set up recovery, then **Add a server → Create a
server** to create your community. A NexSpeak server is a Matrix space inside your homeserver;
creating one does not install another homeserver.

Chat, attachments and encrypted rooms now work. Continue with [Getting started](getting-started.md)
for normal use, or add calls below.

## Add voice, video and screen sharing

NexSpeak needs a **LiveKit SFU** for media and **lk-jwt-service** for Matrix authentication. The
Element Call web frontend does not need to be hosted for NexSpeak's own call UI. See the upstream
[MatrixRTC prerequisites](https://github.com/element-hq/element-call/blob/main/docs/self_hosting.md#prerequisites).

The following adds both services on the same Linux server. Create the `rtc.example.com` and
`livekit.example.com` DNS records and open TCP 7881 and UDP 7882 first. Screen sharing sends media
through your SFU, so plan for its outbound bandwidth as well as disk space for chat.

### Configure LiveKit and authorization

Generate a separate secret with `openssl rand -hex 32`. Save it as the sole line of a new file
named `livekit-secret`, and use that same value in `livekit.yaml`:

```yaml
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true
room:
  auto_create: false
keys:
  nexspeak: REPLACE_WITH_THE_LIVEKIT_SECRET
```

`use_external_ip` discovers the public media address. Check LiveKit's logs; if it chooses the wrong
address, follow the `node_ip` instructions in its
[sample configuration](https://github.com/livekit/livekit/blob/master/config-sample.yaml).

Add these services under `services:` in the existing `compose.yaml`:

```yaml
  livekit:
    image: livekit/livekit-server:v1.13.10
    restart: unless-stopped
    network_mode: host
    command: [--config, /etc/livekit.yaml]
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro

  lk-jwt-service:
    image: ghcr.io/element-hq/lk-jwt-service:0.9.0
    restart: unless-stopped
    ports:
      - 127.0.0.1:8080:8080
    environment:
      LIVEKIT_URL: wss://livekit.example.com
      LIVEKIT_KEY: nexspeak
      LIVEKIT_SECRET_FROM_FILE: /run/secrets/livekit-secret
      LIVEKIT_FULL_ACCESS_HOMESERVERS: matrix.example.com
    volumes:
      - ./livekit-secret:/run/secrets/livekit-secret:ro
    depends_on:
      - livekit
```

Protect `.env`, `synapse/`, `livekit.yaml` and `livekit-secret` from other host users, while allowing
the respective containers to read their files. Keep the two LiveKit secret values identical.
Use the Matrix **server name**, not an API URL, for `LIVEKIT_FULL_ACCESS_HOMESERVERS`, and keep
`room.auto_create: false`; together these restrict who can create calls on your infrastructure.
Do not use `*` as the allowlist for a private deployment. See the
[authorization-service configuration](https://github.com/element-hq/lk-jwt-service/blob/v0.9.0/README.md#%EF%B8%8F-configuration).

Add these two site blocks to `Caddyfile`:

```caddyfile
rtc.example.com {
    reverse_proxy 127.0.0.1:8080
}

livekit.example.com {
    reverse_proxy 127.0.0.1:7880
}
```

Caddy handles HTTPS and WebSocket signalling. In the host/provider firewall, keep 7880 private;
only 7881/TCP and 7882/UDP are public media ports. LiveKit uses host networking, so its listeners
are not restricted by Docker port mappings. An ordinary HTTP proxy does not forward UDP media.

This small deployment uses direct UDP with TCP fallback. For networks that only allow HTTPS,
add LiveKit's TURN/TLS support using the
[LiveKit deployment guide](https://docs.livekit.io/transport/self-hosting/deployment/).
TURN on TCP 443 needs its own address or suitable layer-4 routing when Caddy already owns that port.
See [LiveKit's port reference](https://docs.livekit.io/transport/self-hosting/ports-firewall/).

### Advertise the call service

Add the following to `synapse/homeserver.yaml`, merging with any existing sections:

```yaml
experimental_features:
  msc3266_enabled: true
  msc4143_enabled: true
  msc4222_enabled: true

max_event_delay_duration: 24h

rc_message:
  per_second: 0.5
  burst_count: 30

rc_delayed_event_mgmt:
  per_second: 1
  burst_count: 20

matrix_rtc:
  transports:
    - type: livekit
      livekit_service_url: https://rtc.example.com
```

NexSpeak currently uses the authorization service's direct `/sfu/get` endpoint. This example
therefore advertises `livekit_service_url`, the compatibility mode still supported by
[lk-jwt-service](https://github.com/element-hq/lk-jwt-service). An installation that only advertises
the newer `url` transport with application-service authentication is not sufficient for the
current NexSpeak client.

For the `.well-known` fallback, replace the existing **client** discovery response in `Caddyfile`
with this single line; keep the server-discovery response as it is:

```caddyfile
respond /.well-known/matrix/client `{"m.homeserver":{"base_url":"https://matrix.example.com"},"org.matrix.msc4143.rtc_foci":[{"type":"livekit","livekit_service_url":"https://rtc.example.com"}]}`
```

The advertised address is the **HTTPS authorization service**, not the LiveKit WebSocket address.
NexSpeak checks the authenticated transport endpoint first and then `.well-known`; no custom
NexSpeak build is required.

Apply and check the configuration:

```bash
docker compose config --quiet
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
docker compose up -d
docker compose restart synapse
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
curl -fsS https://rtc.example.com/healthz
curl -fsS https://matrix.example.com/.well-known/matrix/client
```

Test a call with two accounts, including one on another network. Check voice in both directions,
video, screen sharing and an encrypted channel. **Voice Connected → Connection details** shows
the connection, and **Stream info** helps diagnose video quality. The authorization service must
be able to reach your homeserver's public federation/OpenID API over trusted HTTPS; keep the
`federation` listener resource from step 2. Never enable the development-only TLS verification bypass.

## Backups and updates

Back up the database, `synapse/` (including the signing key and media), `.env`, `compose.yaml`,
`Caddyfile`, and any call-service configuration and secrets. Keep an encrypted copy off the server
and test restoring it. A database backup does not replace users' encryption recovery keys; they
still need [encryption recovery](encryption.md).

For a small installation, this example pauses Synapse while taking a matching database and file
backup. Run it from the deployment directory:

```bash
umask 077
backup_dir="backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
docker compose stop synapse
docker compose exec -T postgres pg_dump -U synapse -d synapse -Fc > "$backup_dir/synapse.dump"
sudo tar -czf - synapse > "$backup_dir/synapse-files.tar.gz"
docker compose start synapse
```

Check both commands succeeded before treating this as a usable backup; restart Synapse if a backup
command fails. Copy the configuration and secrets into the backup too. The custom-format dump is
restored into a fresh PostgreSQL database with `pg_restore`; follow the
[PostgreSQL backup and restore instructions](https://www.postgresql.org/docs/17/backup-dump.html)
and preserve Synapse's original signing key and server name.

Read the [Synapse upgrade notes](https://element-hq.github.io/synapse/latest/upgrade.html), take a
backup, then update the pinned image tags in `compose.yaml` before running:

```bash
docker compose pull
docker compose up -d
docker compose logs --tail=100 synapse
```

Pulling alone does not change pinned release tags. PostgreSQL major-version upgrades require a
database migration; do not simply change `17` to a newer major version on the existing data volume.
Monitor storage, service health and certificate renewal, and configure Docker log rotation so logs
do not consume all available space.

## Troubleshooting

| Symptom | Check |
|---|---|
| HTTPS fails or Caddy cannot obtain a certificate | A/AAAA records, port 80/443 reachability and another process using those ports |
| Sign-in fails | Public `/_matrix/client/versions`, Synapse/PostgreSQL logs, matching database passwords and account domain |
| Federation fails | Public `.well-known/matrix/server`, port 443 and the federation API |
| "Your homeserver doesn't offer voice channels" | `matrix_rtc.transports`, `msc4143_enabled`, discovery JSON and HTTPS on the authorization service |
| Calls fail during authorization | Matching LiveKit key/secret, the homeserver allowlist and public federation/OpenID reachability |
| Call connects but media is missing | Public media IP, UDP 7882/TCP 7881 in both firewalls, NAT forwarding and TURN for restricted networks |

The repository's `dev/docker-compose.yml` is for local tests. It uses fixed secrets, open
registration and development TLS settings; use the deployment above for a public server instead.
