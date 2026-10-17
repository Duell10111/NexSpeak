# NexSpeak

Ein Discord-ähnlicher Client für [Matrix](https://matrix.org): Spaces werden als Server angezeigt, Räume als Kanäle,
dazu Direktnachrichten, Sprach-/Videoanrufe und Bildschirmfreigabe.

- **Chat:** Antworten, Reaktionen, Bearbeiten, Löschen, Tipp-Anzeige, Dateien (auch per Drag & Drop/Einfügen),
  Lesebestätigungen, Einladungen
- **Ende-zu-Ende-Verschlüsselung:** Nachrichten und Anhänge, Recovery-Schlüssel mit Schlüssel-Backup,
  Geräteverifizierung per Emoji-Vergleich (kompatibel mit Element)
- **Anrufe:** MatrixRTC mit LiveKit, kompatibel mit Element Call; in verschlüsselten Räumen sind auch
  die Medien Ende-zu-Ende-verschlüsselt. Bedienung wie bei Discord: Kachelansicht mit Sprech-Anzeige,
  Fokus auf Kamera oder Bildschirmfreigabe, Lautstärke pro Person (Rechtsklick), Chat neben dem Anruf,
  Stummschalten auch vor dem Beitreten, Bildschirmübertragung mit wählbarer Auflösung (bis Quelle) und
  Bildrate (bis 60 FPS), auch während des Streams änderbar
- **Mobile Ansicht:** Navigation und Mitgliederliste als ausklappbare Panels

## Aufbau

| Ordner | Inhalt |
|---|---|
| `apps/web` | Next.js-Web-App (Oberfläche, E2E-Tests) |
| `apps/desktop` | Desktop-App mit Electron (geplant), verpackt den Web-Build |
| `apps/mobile` | Mobile-App mit Expo (geplant) |
| `packages/core` | Matrix- und Anruf-Logik ohne Oberfläche |
| `packages/i18n` | Oberflächentexte (Deutsch, Englisch) |
| `dev` | Lokaler Homeserver mit Anrufen (Docker) |
| `docs` | Planung und Dokumentation |

Alle Befehle werden im Root-Verzeichnis ausgeführt.

## Voraussetzungen

- Node.js 24 (LTS), siehe `.nvmrc` → `nvm use`
- Ein Matrix-Homeserver. Für **Anrufe** muss er einen MatrixRTC-Dienst (LiveKit SFU + [lk-jwt-service](https://github.com/element-hq/lk-jwt-service))
  anbieten – derselbe, den Element Call nutzt. NexSpeak findet ihn in dieser Reihenfolge:
  1. `GET /_matrix/client/unstable/org.matrix.msc4143/rtc/transports` (Synapse: `matrix_rtc.transports`)
  2. `org.matrix.msc4143.rtc_foci` in `/.well-known/matrix/client`
  3. Umgebungsvariable `NEXT_PUBLIC_LIVEKIT_SERVICE_URL` (Fallback beim Build)

  Homeserver mit Element Call (z. B. matrix.org) funktionieren ohne weitere Konfiguration.

## Entwicklung

```bash
nvm use
npm install
npm run dev        # http://localhost:3000
```

### Lokaler Homeserver mit Anrufen

`dev/docker-compose.yml` startet Synapse, LiveKit und lk-jwt-service – fertig konfiguriert für Anrufe:

```bash
docker compose -f dev/docker-compose.yml up -d
```

In der App dann als Homeserver `http://localhost:8008` eintragen. Konten lassen sich ohne Bestätigung registrieren,
z. B. mit Element oder per API. Der Stack ist nur für die Entwicklung gedacht (feste Secrets, selbstsigniertes TLS).

## Tests

```bash
npm test                 # Unit-Tests (Vitest)

docker compose -f dev/docker-compose.yml --profile e2e up -d
npm run test:e2e:docker  # End-to-End-Tests (Playwright) mit Browsern im Linux-Container
npm run test:e2e         # dieselben Tests mit lokal installierten Browsern
```

Die End-to-End-Tests registrieren eigene Benutzer und testen mit mehreren Browsern gleichzeitig Chat,
Verschlüsselung, Anrufe (inkl. E2EE-Audio), Recovery/Verifizierung und die Mobile-Ansicht. Die Browser laufen
standardmäßig im Container, weil Chromium auf manchen macOS-Versionen kein (Fake-)Mikrofon öffnen kann.

## Fehlersuche bei Anrufen

In der Browser-Konsole `localStorage.setItem("nexspeak:debug", "1")` setzen und neu laden – dann loggen
NexSpeak und LiveKit ausführlich. Typische Ursachen:

- „Dein Homeserver bietet keine Sprachkanäle an“: kein MatrixRTC-Dienst gefunden (siehe Voraussetzungen).
- „Keine Berechtigung“: Mitglieder dürfen in diesem Raum keine Anrufe beitreten. Admins sehen im Anruf
  „Für alle erlauben“ (setzt das Power-Level für `org.matrix.msc3401.call.member` auf 0, wie Element).

## Build & Deployment

```bash
npm run build
npm start
```

Die App ist eine rein clientseitige Matrix-Anwendung; Zugangsdaten gehen nur an den Homeserver. Der
LiveKit-E2EE-Worker wird beim Build nach `apps/web/public/livekit-e2ee-worker.mjs` kopiert.

## Mitwirken & Lizenz

Beiträge sind willkommen – siehe [CONTRIBUTING.md](CONTRIBUTING.md). Vor dem ersten Merge ist einmalig die
[CLA](CLA.md) zu unterschreiben (per Kommentar im Pull Request).

NexSpeak steht unter der [GNU Affero General Public License v3.0 oder neuer](LICENSE).
