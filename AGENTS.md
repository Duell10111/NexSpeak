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
- Die Oberfläche ist deutsch.
- Änderungen an Anrufen mit den E2E-Tests in `e2e/call.spec.ts` prüfen (inklusive E2EE).
