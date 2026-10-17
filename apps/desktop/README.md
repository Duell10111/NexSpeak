# NexSpeak Desktop

Electron shell around the web app. The entire UI comes from `apps/web` (static export in
`apps/web/out`); this folder only holds what a browser tab cannot do.

| File | Purpose |
|---|---|
| `src/main.ts` | Window, serving the web build under `app://nexspeak`, permissions, screen capture, hardware encoding flags |
| `src/push-to-talk.ts` | Global push-to-talk key (uiohook), only running during a call with push to talk |
| `src/badge.ts` | Unread badge: dock (macOS), taskbar overlay (Windows), launcher (Linux) |
| `src/deep-links.ts` | `nexspeak://` links from the OS (open-url, second instance, launch arguments) |
| `src/origin.ts` | Origin check for `app://` (`URL.origin` is `"null"` for custom schemes in Node) |
| `src/tray.ts` | Tray icon and menu (open, mute, deafen, leave call, quit) |
| `src/preload.ts` | `window.nexspeak` (contract: `packages/core/src/desktop-bridge.ts`) |
| `electron-builder.yml` | Packages for macOS (dmg/zip), Windows (NSIS) and Linux (AppImage/deb) |
| `build/` | App icon (`icon.icns`, `icon.ico`, `icons/` for Linux) and macOS entitlements |
| `assets/` | Tray icons, unread badge and Linux window icon |
| `scripts/render-icons.mjs` | Renders all app icons (desktop and web) from SVG: `node scripts/render-icons.mjs` (macOS) |
| `e2e/` | Playwright tests driving the real app |

## Commands (in the repository root)

```bash
npm run dev               # terminal 1: Next.js dev server
npm run dev:desktop       # terminal 2: Electron against http://localhost:3000

npm run start:desktop     # export the web app and start Electron with the export
npm run dist:desktop      # installers in apps/desktop/release/
npm run test:e2e:desktop  # E2E tests (the Docker stack from dev/ has to be running)
```

## Security

- `contextIsolation`, `sandbox`, no `nodeIntegration`; the renderer has no Node access.
- The app runs under its own secure scheme `app://nexspeak` with the security headers from
  `apps/web/security-headers.json`.
- Permissions (microphone, camera, screen, notifications) only for the app's own origin.
- Links to other sites open in the default browser; the window never leaves the app.

## Performance

- Hardware acceleration always stays on. On Linux `main.ts` enables VA-API encoding.
- `backgroundThrottling` stays enabled: a hidden window costs practically nothing.
- The spell checker is off (it would download dictionaries from Google and cost memory).

## Tray

Closing the window only hides it; the app keeps running in the tray (e.g. in a call). Quit via the
tray menu or Cmd+Q. Texts and voice state come from the web app over the bridge
(`DesktopTrayLabels`, `DesktopTrayVoice`); the main process has no translations of its own.

## Notifications and badge

The web app decides what notifies (the user's Matrix push rules, see
`packages/core/src/matrix/notifications.ts`) and uses the web `Notification` API, which Electron
shows as native OS notifications; a click brings the window back from the tray (`showWindow`).
The badge shows mentions, unread direct messages and invites (`setBadgeCount`). Windows needs the
AppUserModelID set in `main.ts` for notifications to appear.

## Deep links

`nexspeak://room/<room id or alias>[?via=server]`, `nexspeak://user/<user id>` and
`nexspeak://sso?loginToken=…` (the return from the SSO login, which runs in the default browser).
The main process only validates and queues them until the web app listens; parsing
(`packages/core/src/matrix/links.ts`) and handling happen in the web app, which also opens
matrix.to links from messages the same way. Packaged builds register the scheme with the OS;
an unpackaged dev run does not (it would register the bare Electron binary).

## Push to talk

The web app owns the setting (key, release delay) and the microphone gate; the main process only
reports key presses. While the user is in a call with push to talk, `src/push-to-talk.ts` runs a
system-wide hook (uiohook-napi), so the key also works while a game has the focus.

- The hook receives every input event, including mouse moves; it is started on joining and stopped
  on leaving, never while idle. It copies events on its own thread and does not add input latency.
- macOS needs the accessibility permission (the settings offer a button); until then, and on
  Wayland (no global hooks), the key only works while NexSpeak has the focus.
- Keys are stored as `KeyboardEvent.code` (physical key) or `Mouse3`–`Mouse5`.

## Screen sharing

`getDisplayMedia` goes to `setDisplayMediaRequestHandler`:

- macOS 15+: the system picker (ScreenCaptureKit), no picker of our own.
- Linux with Wayland: the desktop portal's picker.
- Otherwise (Windows, X11): `DesktopSourcePicker` from the web app; Windows also shares the system
  audio via loopback.

## Releases

release-please (`.github/workflows/release-please.yml`) keeps a release PR open on `main`; merging
it tags `vX.Y.Z`, creates the GitHub release and runs `.github/workflows/desktop.yml`, which builds
macOS (arm64 and x64), Windows and Linux and attaches the installers plus the `latest*.yml` files
for auto-update. The Desktop workflow can also be started by hand; the installers then end up as
workflow artifacts only.

Signing switches on with repository secrets (listed at the top of `desktop.yml`). Until then:

- macOS: ad-hoc signed and not notarized. Gatekeeper blocks the first start; open it via System
  Settings → Privacy & Security → "Open Anyway", or run
  `xattr -dr com.apple.quarantine /Applications/NexSpeak.app`. Auto-update on macOS needs a
  Developer ID signature.
- Windows: SmartScreen warns; "More info" → "Run anyway".

## Still open (milestone "Beta 0.2 – Desktop")

Auto-update (#6), autostart (#7), app icon (#8), Developer ID signing and notarization and Windows
code signing (#9).
