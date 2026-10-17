# NexSpeak Desktop

Electron-Hülle um die Web-App. Die gesamte Oberfläche kommt aus `apps/web` (statischer Export in
`apps/web/out`); hier liegt nur, was ein Browser-Tab nicht kann.

| Datei | Aufgabe |
|---|---|
| `src/main.ts` | Fenster, Auslieferung des Web-Builds unter `app://nexspeak`, Berechtigungen, Bildschirmaufnahme, Hardware-Encoding-Flags |
| `src/preload.ts` | `window.nexspeak` (Vertrag: `packages/core/src/desktop-bridge.ts`) |
| `electron-builder.yml` | Pakete für macOS (dmg/zip), Windows (NSIS) und Linux (AppImage/deb) |
| `e2e/` | Playwright-Tests mit der echten App |

## Befehle (im Repo-Root)

```bash
npm run dev               # Terminal 1: Next.js-Dev-Server
npm run dev:desktop       # Terminal 2: Electron gegen http://localhost:3000

npm run start:desktop     # Web exportieren und Electron mit dem Export starten
npm run dist:desktop      # Installationspakete nach apps/desktop/release/
npm run test:e2e:desktop  # E2E-Tests (Docker-Stack aus dev/ muss laufen)
```

## Sicherheit

- `contextIsolation`, `sandbox`, kein `nodeIntegration`; der Renderer hat keinen Node-Zugriff.
- Die App läuft unter dem eigenen, sicheren Schema `app://nexspeak` mit den Security-Headern aus
  `apps/web/security-headers.json`.
- Berechtigungen (Mikrofon, Kamera, Bildschirm, Benachrichtigungen) nur für die eigene Origin.
- Links zu anderen Seiten öffnen im Standard-Browser; das Fenster verlässt die App nie.

## Leistung

- Hardware-Beschleunigung bleibt immer an. Unter Linux schaltet `main.ts` VA-API-Encoding ein.
- `backgroundThrottling` bleibt aktiv: ein verstecktes Fenster kostet praktisch nichts.
- Rechtschreibprüfung ist aus (lädt sonst Wörterbücher von Google und kostet Speicher).

## Bildschirmübertragung

`getDisplayMedia` geht an `setDisplayMediaRequestHandler`:

- macOS 15+: Systemauswahl (ScreenCaptureKit), kein eigener Dialog.
- Linux mit Wayland: Auswahl des Desktop-Portals.
- Sonst (Windows, X11): der Dialog `DesktopSourcePicker` aus der Web-App; Windows überträgt den
  Systemton per Loopback.

## Noch offen (Milestone „Beta 0.2 – Desktop“)

Tray, Push-to-Talk, native Benachrichtigungen, Auto-Update, Deep Links (`nexspeak://`),
App-Icon, Signierung und Notarisierung.
