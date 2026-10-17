# AGENTS.md

Hinweise für KI-Agenten und Mitwirkende an Nexspeak (Discord-ähnlicher Matrix-Client mit
MatrixRTC/LiveKit-Anrufen).

## Oberste Priorität: Leistungseffizienz

Nexspeak läuft neben Spielen. Jede CPU-, GPU- und Speicherlast, die wir erzeugen, fehlt dem
Spiel. **So wenig Leistung wie möglich zu ziehen hat bei jeder Änderung hohen Stellenwert** –
im Zweifel gewinnt die sparsamere Lösung gegenüber einem Komfort-Feature. Neue Funktionen
müssen im Ruhezustand (Fenster im Hintergrund, kein Anruf) praktisch nichts kosten.

### Medien (Anrufe, Kamera, Bildschirmübertragung)

- **Video wird mit H.264 kodiert** (`packages/core/src/video-codec.ts`, `publishDefaults` in
  `packages/core/src/matrix/call-session.ts`). H.264 ist der Codec, den alle Zielplattformen in Hardware
  kodieren:
  - macOS: VideoToolbox (Apple Silicon und Intel)
  - Windows mit NVIDIA: NVENC, mit AMD: AMF, mit Intel: Quick Sync (jeweils über Media Foundation)
  - Linux: VA-API, in Chromium nur mit `--enable-features=AcceleratedVideoEncoder` bzw.
    `VaapiVideoEncoder`. Für eine spätere Desktop-App (Electron o. Ä.) diese Flags setzen und
    Hardware-Beschleunigung nicht deaktivieren.

  Zwei Fallen, die sonst still zu Software-Kodierung führen (`packages/core/src/video-codec.ts`):
  - LiveKit handelt nur H.264 Constrained Baseline aus, Chrome auf macOS kodiert dieses Profil
    aber nur in Software. Die Sendeverbindung nutzt deshalb lokal Main unter derselben
    Payload-Type-Nummer (`installH264MainProfilePreference`); nicht entfernen.
  - Hardware-Encoder lehnen ungerade Bildgrößen ab (z. B. ein 1728×1117-Fenster). Die
    Bildschirmübertragung skaliert deshalb minimal auf gerade Maße (`evenScale`).

  Prüfen auf einem Rechner mit GPU: `cd apps/web && E2E_HARDWARE=1 npx playwright test hardware-encoding`
  (lokales Chrome, nicht die Docker-Browser).

  Firefox nutzt für H.264 (zumindest auf macOS) immer Software (OpenH264) und meldet weder
  Encoder noch CPU-Limit in den Stats; deshalb weist die Oberfläche dort darauf hin und erkennt
  Überlast über die Kodierzeit pro Bild. Eine spätere Desktop-App sollte eine Engine mit
  Hardware-Encoding nutzen (Chromium/WebView2, WKWebView).
  Ohne Hardware-Encoder fällt der Browser selbst auf Software-H.264 (OpenH264) zurück. VP8 nur,
  wenn H.264 gar nicht verfügbar ist. Keinen anderen Codec (VP9, AV1) als Standard einführen,
  solange er nicht auf allen Zielplattformen in Hardware kodiert wird.
- **Jede Simulcast-Ebene ist ein eigener Encoder** – bei Hardware-Encoding auch eine eigene
  Encoder-Session (NVIDIA-Consumer-Karten erlauben nur wenige gleichzeitige Sessions, die sich
  Spiel-Aufnahme-Tools teilen). Deshalb höchstens zwei Ebenen pro Videospur (Kamera: Original +
  360p, Bildschirm: Original + halbe Auflösung). Keine zusätzlichen Ebenen ohne guten Grund.
- Qualität kommt aus den Einstellungen des Nutzers (`packages/core/src/screenshare-quality.ts`), nicht aus
  festen hohen Werten. Nichts kodieren, was niemand sieht: `dynacast` und `adaptiveStream`
  bleiben aktiv.
- Keine Bildverarbeitung im Hauptthread (Canvas-Kopien, Filter, eigene Frame-Schleifen). Wenn
  etwas pro Frame passieren muss, in einem Worker (wie die E2EE-Verschlüsselung).
- Ob wirklich in Hardware kodiert wird, zeigt das Stream-Menü im Anruf (WebRTC-Stats
  `powerEfficientEncoder`/`encoderImplementation`). Bei Änderungen an der Kodierung dort prüfen.

### Oberfläche

- Kein Polling, solange die Daten nicht sichtbar sind (siehe `EncoderStatus` in `call-area.tsx`:
  Stats nur bei geöffnetem Menü). Lieber Events des Matrix-SDK bzw. von LiveKit abonnieren.
- Häufige Ereignisse (Sprech-Anzeige, Mitgliederlisten, Tippen) gebündelt verarbeiten, z. B.
  per `requestAnimationFrame` wie in `useRtcCallInfo`, statt bei jedem Event neu zu rendern.
- Keine dauerhaft laufenden Animationen und keine Timer im Ruhezustand.
- Neue Abhängigkeiten nur, wenn sie ihr Gewicht wert sind; große Bibliotheken nicht für
  Kleinigkeiten.

## Projekt

- Monorepo mit npm Workspaces:
  - `apps/web` – Next.js-App (Oberfläche, Hooks, E2E-Tests); `@/` zeigt auf `apps/web/src`.
  - `apps/desktop` – Electron-Hülle um den Web-Build, kein eigener UI-Code. Desktop-Funktionen
    laufen über `window.nexspeak` (Vertrag: `packages/core/src/desktop-bridge.ts`, in der Web-App
    über `desktopBridge()` aus `@/lib/desktop`); im Browser fehlt die Bridge, also immer prüfen.
    Renderer bleibt in der Sandbox ohne Node; der Preload darf zur Laufzeit nur `electron`
    importieren. Hardware-Beschleunigung nie abschalten.
  - `apps/mobile` – Expo-App (geplant).
  - `packages/core` (`@nexspeak/core/...`) – Matrix- und Anruf-Logik ohne UI; importiert nie
    aus `apps/`. Direkte Browser-APIs nur, wo es (noch) nicht anders geht.
  - `packages/i18n` (`@nexspeak/i18n`) – Wörterbücher und `t()`.
  Pakete liefern TypeScript-Quellen direkt aus (kein eigener Build-Schritt).
- Die Web-App ist ein **statischer Export** (`output: "export"` → `apps/web/out/`), den auch die
  Desktop-App lädt. Keine Server-Funktionen von Next.js: keine API-Routen, Server Actions,
  Middleware, `headers()`/Cookies, Bildoptimierung oder dynamische Routen ohne
  `generateStaticParams`. Security-Header stehen in `apps/web/security-headers.json`
  (Hosting: `docs/hosting.md`).
- Node 24 (`.nvmrc`). Befehle im Root: `npm run dev`, `npm run build`, `npm run lint`,
  `npm run typecheck`, `npm test` (Vitest über alle Workspaces), `npm run test:e2e:docker`
  (Playwright gegen `dev/docker-compose.yml`). Desktop: `npm run dev:desktop`,
  `npm run test:e2e:desktop`, `npm run dist:desktop`. Abhängigkeiten mit `-w <workspace>` installieren,
  z. B. `npm install foo -w @nexspeak/web`.
- Werte (keine reinen Typen) aus Unterordnern von `matrix-js-sdk` mit vollem Pfad importieren
  (`matrix-js-sdk/lib/matrixrtc/index.js`), sonst kann Next.js das SDK nicht als externes Paket
  laden („Package matrix-js-sdk can't be external“).
- Die Oberfläche gibt es auf Deutsch und Englisch (`packages/i18n`, ohne Bibliothek). Neue Texte
  nie fest in Komponenten schreiben, sondern als Schlüssel in `de.ts` (Referenz) und `en.ts`
  anlegen; in Komponenten `useTranslation()`, außerhalb von React `t()`. Ohne gespeicherte Wahl
  folgt die Sprache dem Browser. Die E2E-Tests laufen mit `locale: "de-DE"` gegen die deutsche
  Oberfläche.
- Änderungen an Anrufen mit den E2E-Tests in `apps/web/e2e/call.spec.ts` prüfen (inklusive E2EE).
- **Alles im Code ist Englisch:** Kommentare, Bezeichner, Log- und Fehlermeldungen für
  Entwickler, Testnamen, Commit-Messages und PR-Titel. Deutsch gibt es nur in den
  Oberflächentexten (`de.ts`) und in Dokumenten für Menschen (README, `docs/`).
- Lizenz: AGPL-3.0-or-later (`LICENSE`). Neue Abhängigkeiten müssen damit vereinbar sein
  (MIT, ISC, BSD, Apache-2.0, MPL-2.0, (A)GPL-3.0 – keine proprietären oder „non-commercial“
  Lizenzen). Externe Beiträge brauchen eine unterschriebene CLA (`CLA.md`).

## Server-Modell (Discord → Matrix)

Wie Element, damit beide Clients dieselbe Struktur sehen (`packages/core/src/matrix/server.ts`):

- Server = Space, Kategorie = Unter-Space, Kanal = Raum (Text und Sprache zugleich).
- Reihenfolge = `order` in `m.space.child` (`packages/core/src/matrix/space-order.ts`). Verschieben
  schreibt möglichst nur ein Event, denn echte Homeserver begrenzen Events pro Sekunde stark.
- Offener Kanal = Join-Rule `restricted` auf den Server; privater Kanal = `invite`.
  Server-Einladungen laden nie in private Kanäle ein.
- Rollen = Power-Levels (Admin 100, Moderator 50, Mitglied 0), serverweit in allen Räumen
  gesetzt. Icons = `m.room.avatar`, Beschreibung/Thema = `m.room.topic`.
- Räume lassen sich in Matrix nicht löschen: „Löschen“ entfernt den Kanal aus dem Server,
  wirft alle Mitglieder raus und verlässt ihn.
- Neue Kanäle/Kategorien des offenen Servers werden automatisch beigetreten, aber nur wenn
  sich die Struktur ändert (kein Polling).
