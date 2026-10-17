# Plan: Beta-Veröffentlichung, Monorepo, Desktop und Mobile

Stand: 2026-10-17

Ziel: NexSpeak als öffentliche Beta veröffentlichen (Web und Desktop) und das Repo jetzt so
strukturieren, dass eine spätere Mobile-App (Expo) ohne erneuten Umbau dazukommt.

## Ausgangslage

- **Rein clientseitige App:** keine API-Routen, keine Server-Komponenten mit Logik, nur zwei
  Dateien nutzen `next/navigation`. Ein statischer Export (`output: "export"`) ist möglich –
  Voraussetzung dafür, dass Electron die App ohne Node-Server lädt.
- **Matrix-Logik ist bereits gut getrennt:** `src/lib/matrix`, `src/lib/i18n`, `call-layout`,
  `screenshare-quality` sind UI-frei. In `src/lib/matrix` gibt es nur 13 direkte Zugriffe auf
  `localStorage`/`window`/`document`.
- **Ballast:** 37 von 57 Komponenten in `src/components/ui` werden nirgends importiert
  (chart/recharts, carousel, calendar, input-otp, sidebar, …), dazu Vorlagen-Reste
  (`public/next.svg`, `public/vercel.svg`, `public/file.svg`, `public/globe.svg`,
  `public/window.svg`, `nexspeak-web.iml`) und `@vercel/analytics`. Widerspricht dem
  Leistungsziel aus `AGENTS.md`.
- **`.idea/`-Dateien sind gestaged,** obwohl `.gitignore` sie ausschließt.
- **Fehlende Funktionen für eine Beta:** Desktop-Benachrichtigungen, Markdown/`formatted_body`,
  Profil bearbeiten, Threads, angepinnte Nachrichten, Nutzer ignorieren/melden, OIDC/SSO-Login.

## 1. Zielstruktur

npm Workspaces (Expo erkennt npm-Monorepos selbst; Turborepo erst, wenn Builds spürbar langsam
werden).

```
nexspeak/
├─ apps/
│  ├─ web/          Next.js, statischer Export (heutiges src/, e2e/, public/)
│  ├─ desktop/      Electron: main, preload, Packaging; lädt den Build aus apps/web/out
│  └─ mobile/       Expo (vorerst nur README/Platzhalter)
├─ packages/
│  ├─ core/         Matrix-Logik ohne UI: matrix/*, Server-Modell, space-order, call-layout,
│  │                screenshare-quality, Fehler, Typen – Plattformzugriffe nur über Adapter
│  └─ i18n/         de.ts / en.ts / t(), von allen Apps genutzt
├─ dev/             Docker-Stack (Synapse, LiveKit, lk-jwt-service)
├─ docs/            Architektur, Release-Ablauf, Hosting (CSP-/Header-Beispiele)
├─ .github/         Workflows, Issue-/PR-Vorlagen, CODEOWNERS
├─ LICENSE, THIRD_PARTY_NOTICES.md, CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md
├─ tsconfig.base.json, eslint.config.mjs, vitest.config.ts   gemeinsame Konfiguration
└─ AGENTS.md        übergreifende Regeln; je App eine kurze eigene AGENTS.md
```

**Warum `apps/desktop` getrennt, obwohl Web und Desktop eine Codebase teilen?** Der Code ist
derselbe – Desktop verpackt den Web-Build. In `apps/desktop` liegen nur Electron-Hauptprozess,
Preload und Packaging. So landen `electron`/`electron-builder` nicht in den Web-Abhängigkeiten,
der Hauptprozess bekommt eine eigene Node-tsconfig, und CI baut Desktop nur bei relevanten
Änderungen.

### Plattform-Adapter in `packages/core`

`core` greift nie direkt auf Browser-APIs zu, sondern über Schnittstellen, die jede App liefert:

| Schnittstelle | Web | Desktop | Mobile |
|---|---|---|---|
| `Storage` | localStorage / IndexedDB | wie Web | MMKV / SQLite |
| `Notifier` | Web Notifications | Electron `Notification` | Expo Notifications |
| Medien / Bildschirm | `getDisplayMedia` | `desktopCapturer` | `react-native-webrtc` |

**Größtes Risiko für Mobile:** Die E2EE-Crypto des matrix-js-sdk läuft als WASM (Rust-Crypto).
Ob das unter Hermes/React Native läuft, ist offen. Vor ernsthafter Mobile-Planung einen Spike
machen; Alternative wären native Bindings an matrix-rust-sdk. LiveKit hat ein eigenes
React-Native-SDK.

## 2. Umbau – Reihenfolge

1. **Aufräumen (eigener PR)** – erledigt (2026-10-17)
   - `.idea/` und `nexspeak-web.iml` aus dem Index nehmen.
   - Ungenutzte UI-Komponenten und ihre Abhängigkeiten entfernen (recharts, embla-carousel,
     react-day-picker, input-otp, cmdk, vaul, react-resizable-panels, … – jeweils prüfen).
   - Vorlagen-Assets und `@vercel/analytics` entfernen.
2. **Monorepo-Umzug (eigener PR, nur Verschiebungen)** – erledigt (2026-10-17)
   - Mit `git mv`, damit die Historie erhalten bleibt.
   - `src/` → `apps/web/`, Matrix-Logik → `packages/core`, i18n → `packages/i18n`.
   - Pfad-Aliase, Vitest-, Playwright- und ESLint-Konfiguration anpassen.
   - Keine Logikänderungen, damit der PR leicht prüfbar bleibt.
   - Umgesetzt ohne eigenes `packages/config`: tsconfig-Basis, ESLint und Vitest liegen im Root.
     `audio-settings.ts` (Browser-Einstellung) und `utils.ts` (Tailwind) bleiben in `apps/web`.
3. **Statischer Export der Web-App** – erledigt (2026-10-17), siehe `docs/hosting.md`
   - `output: "export"` setzen.
   - Die Security-Header aus `next.config.ts` entfallen dabei: als Hosting-Beispiel
     (Caddy/nginx) nach `docs/`, in Electron per CSP bzw. `session.webRequest`.
4. **Electron-Grundgerüst**
   - `contextIsolation`, `sandbox`, kein `nodeIntegration`.
   - Hardware-Encoder-Flags laut `AGENTS.md` (`AcceleratedVideoEncoder`, VA-API unter Linux);
     Hardware-Beschleunigung nie deaktivieren.
   - `setDisplayMediaRequestHandler` mit eigenem Quellen-Dialog für die Bildschirmübertragung.
   - Tray, native Benachrichtigungen, globales Push-to-Talk.
   - Protokoll-Handler `nexspeak://` für den SSO/OIDC-Rücksprung.
   - Auto-Update mit electron-updater über GitHub Releases.
5. **Mobile:** nur Platzhalter und Crypto-Spike, kein produktiver Code vor der Web-/Desktop-Beta.

## 3. Lizenz, Open Source, Rechtliches

### Lizenz: AGPL-3.0

- `LICENSE` mit AGPL-3.0-or-later im Root; SPDX-Feld `"license": "AGPL-3.0-or-later"` in allen
  `package.json`.
- **Netzwerk-Klausel:** Wer eine (veränderte) Instanz hostet, muss den Quellcode anbieten. Der
  Über-Dialog verlinkt deshalb immer auf den Quellcode der laufenden Version (Repo + Commit).
- **CLA für Beiträge:** Apple-App-Store-Bedingungen gelten als unvereinbar mit (A)GPL. Als
  alleiniger Rechteinhaber kannst du die App trotzdem dort vertreiben – das bleibt aber nur so,
  wenn Beiträge Dritter unter einem CLA stehen (z. B. über die GitHub-App „CLA assistant“). Das
  CLA vor dem ersten externen Beitrag einführen.
- Abhängigkeiten: matrix-js-sdk und livekit-client (Apache-2.0) sowie die übrigen MIT/ISC-Pakete
  sind mit AGPL-3.0 vereinbar.

### Open-Source-Liste und Credits

- Build-Skript (z. B. `generate-license-file`) erzeugt `THIRD_PARTY_NOTICES.md` und ein JSON.
- Die App zeigt das JSON unter *Einstellungen → Über* an.
- CI-Check bricht ab, wenn eine Abhängigkeit mit unpassender Lizenz hinzukommt.
- Eingebaute Emoji-Daten und Icons (lucide: ISC) gesondert aufführen.
- **Über-Dialog:** Version, Git-Commit, Links (Quellcode, Issues, Datenschutz), Lizenzen,
  Mitwirkende.

### Rechtliches und Repo-Dokumente

- Für eine öffentlich gehostete Instanz in Deutschland: Impressum und Datenschutzerklärung.
- `SECURITY.md` mit Meldeweg für Sicherheitslücken (Pflicht bei einer E2EE-App).
- `CONTRIBUTING.md` (Setup, Commit-Konventionen, CLA, i18n-Regeln), `CODE_OF_CONDUCT.md`.

## 4. Funktionen

### Milestone „Beta 0.1 – Web“ (Muss)

- [ ] Login per OIDC (Next-gen Auth/MAS, nötig für matrix.org), dazu SSO und Registrierung
- [ ] Markdown senden; `formatted_body` sicher (bereinigt) darstellen
- [ ] Mentions mit Autovervollständigung (@Person, #Kanal)
- [ ] Desktop-Benachrichtigungen mit Einstellung pro Server/Kanal (Push-Rules: alle / Mentions / stumm)
- [ ] Profil bearbeiten (Anzeigename, Avatar), Presence setzen
- [ ] Threads anzeigen und beantworten
- [ ] Angepinnte Nachrichten (`m.room.pinned_events`)
- [ ] Nutzer ignorieren, Inhalte melden
- [ ] Über-Dialog mit Lizenzen und Quellcode-Link; Feedback über GitHub Issues, kein Tracking

### Milestone „Beta 0.2 – Desktop“

- [ ] Electron-App (siehe Schritt 4)
- [ ] Push-to-Talk, Tray, Autostart, Auto-Update
- [ ] Signierte Builds (macOS: Apple-Developer-Account 99 $/Jahr für Signatur/Notarisierung;
      Windows: optional, sonst SmartScreen-Warnung)

### Später (0.3+)

- Nachrichtensuche, Link-Vorschau (opt-in), eigene Emojis (`im.ponies`), Umfragen
- Bessere Rauschunterdrückung und Sprachaktivierung
- Milestone „Mobile Alpha“ nach erfolgreichem Crypto-Spike

## 5. GitHub-Organisation

- **Milestones:** `Beta 0.1 – Web`, `Beta 0.2 – Desktop`, `0.3`, `Mobile Alpha`
- **Labels:**
  - Bereich: `area:web`, `area:desktop`, `area:mobile`, `area:core`, `area:calls`, `area:repo`
  - Art: `type:bug`, `type:feature`, `type:chore`
  - Sonstige: `perf`, `good first issue`, `needs-decision`
- **Vorlagen:** Issue-Formulare (Bug mit Homeserver/Plattform/Browser, Feature) und
  PR-Vorlage mit Checkliste (i18n-Schlüssel, Leistung, E2E bei Anruf-Änderungen).
- **Board:** GitHub Project.
- **CI (GitHub Actions):**
  - Bei jedem PR: Lint, Typecheck, Vitest, Build, Lizenz-Check.
  - E2E mit Docker-Stack bei PRs auf `main` oder per Label.
  - Desktop-Builds als Matrix (macOS, Windows, Linux) bei Tags.
- **Releases:** ein gemeinsamer Versionsstand für Web und Desktop, automatisiert über
  release-please (Conventional Commits) inkl. Changelog.
- **Branches:** `main` geschützt, Arbeit über Feature-Branches und PRs; `v1` nach dem Umbau mergen.
- Lokaler Ordner `nexspeak-web` → `nexspeak` umbenennen (GitHub-Repo heißt bereits `NexSpeak`).

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Lizenz | AGPL-3.0-or-later (`LICENSE`), CLA für Beiträge (`CLA.md`, `.github/workflows/cla.yml`) |
| Desktop | Electron, eigener Ordner `apps/desktop` (Empfehlung, offen) |
| Package-Manager | npm Workspaces (Empfehlung, offen) |
| Milestones/Labels | angelegt (2026-10-17); `bug`/`enhancement` umbenannt in `type:bug`/`type:feature` |
