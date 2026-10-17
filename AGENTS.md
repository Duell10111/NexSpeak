# AGENTS.md

Hinweise für KI-Agenten und Mitwirkende an Nexspeak (Discord-ähnlicher Matrix-Client mit
MatrixRTC/LiveKit-Anrufen).

## Oberste Priorität: Leistungseffizienz

Nexspeak läuft neben Spielen. Jede CPU-, GPU- und Speicherlast, die wir erzeugen, fehlt dem
Spiel. **So wenig Leistung wie möglich zu ziehen hat bei jeder Änderung hohen Stellenwert** –
im Zweifel gewinnt die sparsamere Lösung gegenüber einem Komfort-Feature. Neue Funktionen
müssen im Ruhezustand (Fenster im Hintergrund, kein Anruf) praktisch nichts kosten.

### Medien (Anrufe, Kamera, Bildschirmübertragung)

- **Video wird mit H.264 kodiert** (`src/lib/video-codec.ts`, `publishDefaults` in
  `src/lib/matrix/call-session.ts`). H.264 ist der Codec, den alle Zielplattformen in Hardware
  kodieren:
  - macOS: VideoToolbox (Apple Silicon und Intel)
  - Windows mit NVIDIA: NVENC, mit AMD: AMF, mit Intel: Quick Sync (jeweils über Media Foundation)
  - Linux: VA-API, in Chromium nur mit `--enable-features=AcceleratedVideoEncoder` bzw.
    `VaapiVideoEncoder`. Für eine spätere Desktop-App (Electron o. Ä.) diese Flags setzen und
    Hardware-Beschleunigung nicht deaktivieren.

  Zwei Fallen, die sonst still zu Software-Kodierung führen (`src/lib/video-codec.ts`):
  - LiveKit handelt nur H.264 Constrained Baseline aus, Chrome auf macOS kodiert dieses Profil
    aber nur in Software. Die Sendeverbindung nutzt deshalb lokal Main unter derselben
    Payload-Type-Nummer (`installH264MainProfilePreference`); nicht entfernen.
  - Hardware-Encoder lehnen ungerade Bildgrößen ab (z. B. ein 1728×1117-Fenster). Die
    Bildschirmübertragung skaliert deshalb minimal auf gerade Maße (`evenScale`).

  Prüfen auf einem Rechner mit GPU: `E2E_HARDWARE=1 npx playwright test hardware-encoding`
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
- Qualität kommt aus den Einstellungen des Nutzers (`src/lib/screenshare-quality.ts`), nicht aus
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

- Node 24 (`.nvmrc`). Befehle: `npm run dev`, `npm run build`, `npm run lint`, `npm test`
  (Vitest), `npm run test:e2e:docker` (Playwright gegen `dev/docker-compose.yml`).
- Die Oberfläche gibt es auf Deutsch und Englisch (`src/lib/i18n`, ohne Bibliothek). Neue Texte
  nie fest in Komponenten schreiben, sondern als Schlüssel in `de.ts` (Referenz) und `en.ts`
  anlegen; in Komponenten `useTranslation()`, außerhalb von React `t()`. Ohne gespeicherte Wahl
  folgt die Sprache dem Browser. Die E2E-Tests laufen mit `locale: "de-DE"` gegen die deutsche
  Oberfläche.
- Änderungen an Anrufen mit den E2E-Tests in `e2e/call.spec.ts` prüfen (inklusive E2EE).

## Server-Modell (Discord → Matrix)

Wie Element, damit beide Clients dieselbe Struktur sehen (`src/lib/matrix/server.ts`):

- Server = Space, Kategorie = Unter-Space, Kanal = Raum (Text und Sprache zugleich).
- Reihenfolge = `order` in `m.space.child` (`src/lib/matrix/space-order.ts`). Verschieben
  schreibt möglichst nur ein Event, denn echte Homeserver begrenzen Events pro Sekunde stark.
- Offener Kanal = Join-Rule `restricted` auf den Server; privater Kanal = `invite`.
  Server-Einladungen laden nie in private Kanäle ein.
- Rollen = Power-Levels (Admin 100, Moderator 50, Mitglied 0), serverweit in allen Räumen
  gesetzt. Icons = `m.room.avatar`, Beschreibung/Thema = `m.room.topic`.
- Räume lassen sich in Matrix nicht löschen: „Löschen“ entfernt den Kanal aus dem Server,
  wirft alle Mitglieder raus und verlässt ihn.
- Neue Kanäle/Kategorien des offenen Servers werden automatisch beigetreten, aber nur wenn
  sich die Struktur ändert (kein Polling).
