# Plan: beta release, monorepo, desktop and mobile

Last updated: 2026-10-17

Goal: release NexSpeak as a public beta (web and desktop) and structure the repository now so that a
later mobile app (Expo) can be added without another restructuring.

## Starting point

- **Purely client-side app:** no API routes, no server components with logic, only two files use
  `next/navigation`. A static export (`output: "export"`) is possible – the prerequisite for Electron
  loading the app without a Node server.
- **Matrix logic was already well separated:** `src/lib/matrix`, `src/lib/i18n`, `call-layout` and
  `screenshare-quality` contained no UI. `src/lib/matrix` had only 13 direct uses of
  `localStorage`/`window`/`document`.
- **Dead weight:** 37 of 57 components in `src/components/ui` were not imported anywhere
  (chart/recharts, carousel, calendar, input-otp, sidebar, …), plus template leftovers
  (`public/*.svg`, `nexspeak-web.iml`) and `@vercel/analytics` – against the performance goal in
  `AGENTS.md`.
- **Missing beta features:** desktop notifications, Markdown/`formatted_body`, profile editing,
  threads, pinned messages, ignoring/reporting users, OIDC/SSO login.

## 1. Target structure

npm workspaces (Expo detects npm monorepos on its own; Turborepo only once builds become noticeably
slow).

```
nexspeak/
├─ apps/
│  ├─ web/          Next.js, static export
│  ├─ desktop/      Electron: main, preload, packaging; loads the build from apps/web/out
│  └─ mobile/       Expo (README/placeholder for now)
├─ packages/
│  ├─ core/         Matrix logic without UI: matrix/*, server model, space-order, call-layout,
│  │                screenshare-quality, errors, types – platform access only through adapters
│  └─ i18n/         de.ts / en.ts / t(), used by all apps
├─ dev/             Docker stack (Synapse, LiveKit, lk-jwt-service)
├─ docs/            architecture, release process, hosting (header examples)
├─ .github/         workflows, issue/PR templates, CODEOWNERS
├─ LICENSE, THIRD_PARTY_NOTICES.md, CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md
├─ tsconfig.base.json, eslint.config.mjs, vitest.config.ts   shared configuration
└─ AGENTS.md        repository-wide rules
```

**Why a separate `apps/desktop` although web and desktop share one codebase?** The code is the same
– the desktop app packages the web build. `apps/desktop` only holds the Electron main process, the
preload script and packaging. That keeps `electron`/`electron-builder` out of the web dependencies,
gives the main process its own Node tsconfig, and lets CI build the desktop app only when relevant.

### Platform adapters in `packages/core`

`core` should not use browser APIs directly but interfaces that each app provides:

| Interface | Web | Desktop | Mobile |
|---|---|---|---|
| `Storage` | localStorage / IndexedDB | same as web | MMKV / SQLite |
| `Notifier` | Web Notifications | Electron `Notification` | Expo Notifications |
| Media / screen | `getDisplayMedia` | `desktopCapturer` | `react-native-webrtc` |

The desktop side of this already exists as `packages/core/src/desktop-bridge.ts`.

**Biggest risk for mobile:** matrix-js-sdk's E2EE crypto runs as WASM (Rust crypto). Whether that
works under Hermes/React Native is open. Do a spike before planning mobile seriously; the
alternative would be native bindings to matrix-rust-sdk. LiveKit has its own React Native SDK.

## 2. Restructuring – order

1. **Cleanup** – done (2026-10-17)
   - Stop tracking IDE files, remove unused UI components and their dependencies, template assets
     and `@vercel/analytics`.
2. **Monorepo move (moves only)** – done (2026-10-17)
   - With `git mv` so history is kept: `src/` → `apps/web/`, Matrix logic → `packages/core`,
     i18n → `packages/i18n`.
   - No separate `packages/config`: tsconfig base, ESLint and Vitest live in the root.
     `audio-settings.ts` (a browser setting) and `utils.ts` (Tailwind) stay in `apps/web`.
3. **Static export of the web app** – done (2026-10-17), see `docs/hosting.md`
   - The security headers moved to `apps/web/security-headers.json`; hosts and the desktop app send
     them.
4. **Electron** – base done (2026-10-17): window, `app://` scheme, sandboxing, encoding flags,
   screen source picker, packaging, E2E tests. Tray (#2), push to talk (#3), notifications (#4) and
   deep links (#5) done. Open: auto-update (#6), autostart (#7), icon (#8), signing (#9), push-to-talk
   hook performance (#10).
5. **Mobile:** placeholder and crypto spike only, no production code before the web/desktop beta.

## 3. License, open source, legal

### License: AGPL-3.0

- `LICENSE` with AGPL-3.0-or-later in the root; SPDX field `"license": "AGPL-3.0-or-later"` in all
  `package.json` files.
- **Network clause:** anyone hosting a (modified) instance has to offer the source code. The about
  dialog therefore always links to the source of the running version (repository + commit).
- **CLA for contributions:** the Apple App Store terms are considered incompatible with the (A)GPL.
  As the sole copyright holder the app can still be distributed there – but only as long as
  third-party contributions are covered by a CLA (`CLA.md`, CLA assistant workflow).
- Dependencies: matrix-js-sdk and livekit-client (Apache-2.0) and the remaining MIT/ISC packages are
  compatible with the AGPL-3.0.

### Open source list and credits

- Done (2026-10-17): `apps/web/scripts/third-party-licenses.mjs` (no dependency) collects the
  production dependencies of web and desktop into `public/third-party-licenses.json` at build time;
  *Settings → About* shows it. `--check` (CI step "License check") fails on unknown or incompatible
  licenses. Open: a `THIRD_PARTY_NOTICES.md` for the repository.
- List bundled emoji data and icons (lucide: ISC) separately.
- **About dialog:** version, git commit, links (source, issues, privacy), licenses, contributors. Done
  except privacy (depends on the hosting instance) and contributors.

### Legal and repository documents

- For a publicly hosted instance in Germany: imprint (Impressum) and privacy policy.
- `SECURITY.md` with a way to report vulnerabilities (a must for an E2EE app).
- `CONTRIBUTING.md` (done), `CODE_OF_CONDUCT.md`.

## 4. Features

### Milestone "Beta 0.1 – Web" (must have)

- [x] SSO login (m.login.sso; also works with MAS via its compatibility layer)
- [x] Native OIDC login (next-gen auth/MAS) and registration – web; the desktop app keeps the SSO
      compatibility flow until it can receive the redirect (loopback or custom scheme)
- [x] Send Markdown; render `formatted_body` safely (sanitized)
- [x] Mentions with autocompletion (@person, #channel)
- [x] Notifications following the push rules, settings for showing them and their content
- [x] Notification settings per server/channel in the UI (push rules: all / mentions / mute)
- [x] Profile editing (display name, avatar), set presence
- [x] Show and reply to threads
- [x] Pinned messages (`m.room.pinned_events`)
- [x] Ignore users, report content
- [x] About dialog with licenses and source link; feedback via GitHub issues, no tracking

### Milestone "Beta 0.2 – Desktop"

- [x] Electron app
- [x] Tray (#2)
- [x] Push to talk (#3)
- [x] Notifications and badge (#4)
- [x] Deep links and SSO login (#5)
- [ ] Auto-update (#6), autostart (#7)
- [ ] App icon (#8)
- [x] Release workflow: release-please and desktop builds attached to the release (unsigned, macOS
      ad-hoc signed)
- [ ] Signed builds (#9; macOS: Developer ID certificate and notarization; Windows: optional, otherwise
      a SmartScreen warning) – only secrets missing, see `.github/workflows/desktop.yml`

### Later (0.3+)

- Message search, link previews (opt-in), custom emoji (`im.ponies`), polls
- Better noise suppression and voice activity detection
- Milestone "Mobile Alpha" after a successful crypto spike

## 5. GitHub organization

- **Milestones:** `Beta 0.1 – Web`, `Beta 0.2 – Desktop`, `0.3`, `Mobile Alpha`
- **Labels:**
  - Area: `area:web`, `area:desktop`, `area:mobile`, `area:core`, `area:calls`, `area:repo`
  - Type: `type:bug`, `type:feature`, `type:chore`
  - Other: `perf`, `good first issue`, `needs-decision`
- **Templates:** issue forms (bug with homeserver/platform/browser, feature) and a PR template with a
  checklist (i18n keys, performance, E2E for call changes).
- **Board:** GitHub Project.
- **CI (GitHub Actions):**
  - On every PR: lint, typecheck, Vitest, build, license check.
  - E2E with the Docker stack on PRs to `main` or by label.
  - Desktop builds as a matrix (macOS, Windows, Linux) on tags.
- **Releases:** one shared version for web and desktop, automated with release-please (Conventional
  Commits) including a changelog.
- **Branches:** `main` protected, work via feature branches and PRs; merge `v1` after the
  restructuring.
- Rename the local folder `nexspeak-web` → `nexspeak` (the GitHub repository is already `NexSpeak`).

## Decisions

| Topic | Decision |
|---|---|
| License | AGPL-3.0-or-later (`LICENSE`), CLA for contributions (`CLA.md`, `.github/workflows/cla.yml`) |
| Desktop | Electron, separate folder `apps/desktop` |
| Package manager | npm workspaces |
| Language | English for code, docs, issues and commits; German only as a UI language |
| Milestones/labels | created (2026-10-17); `bug`/`enhancement` renamed to `type:bug`/`type:feature` |
