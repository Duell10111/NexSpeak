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
| `src/autostart.ts` | "Start at login" (login item on macOS/Windows, XDG autostart entry on Linux), start in the tray |
| `src/updater.ts` | Auto-update from GitHub Releases (electron-updater), held back during calls |
| `src/tray.ts` | Tray icon and menu (open, mute, deafen, leave call, restart to update, quit) |
| `src/preload.ts` | `window.nexspeak` (contract: `packages/core/src/desktop-bridge.ts`) |
| `electron-builder.cjs` | Packages for macOS (dmg/zip), Windows (NSIS) and Linux (AppImage/deb); stable or nightly |
| `src/channel.ts` | Release channel of the build: app id, name and deep-link scheme of stable or nightly |
| `build/` | App icon (`icon.icns`, `icon.ico`, `icons/` for Linux) and macOS entitlements |
| `assets/` | Tray icons, unread badge and Linux window icon |
| `scripts/render-icons.mjs` | Renders all app icons (desktop and web) from SVG: `node scripts/render-icons.mjs` (macOS) |
| `e2e/` | Playwright tests driving the real app |

## Commands (in the repository root)

`npm ci` only patches the pinned `uiohook-napi` source; web work needs no C toolchain.
`dev:desktop`, `start:desktop`, `dist:desktop` and `test:e2e:desktop` compile the filtered input
hook for the host architecture on first use (N-API, shared by Node and Electron). That requires
Python and a C/C++ toolchain: Xcode Command Line Tools on macOS, Visual Studio's Desktop
development with C++ workload on Windows, or `build-essential libx11-dev libxtst-dev libxrandr-dev
libxt-dev` on Debian/Ubuntu. Builds fail if the patch no longer applies; update and review it
alongside any dependency update.

```bash
npm run dev               # terminal 1: Next.js dev server
npm run dev:desktop       # terminal 2: Electron against http://localhost:3000

npm run start:desktop     # export the web app and start Electron with the export
npm run dist:desktop      # installers in apps/desktop/release/
npm run test:e2e:desktop  # E2E tests (the Docker stack from dev/ has to be running)
npm run test:input-hook -w @nexspeak/desktop  # native dispatch regression test, no OS permissions
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

- The hook is started on joining and stopped on leaving, never while idle. The native dispatch
  filters input before allocation and before calling the N-API threadsafe function: only the
  chosen key or mouse button's down/up events reach JavaScript. Mouse movement, dragging,
  scrolling, synthetic clicks and unrelated keys/buttons cause no main-thread wake-ups.
- Changing the binding stops and joins the hook thread, releases the microphone gate and starts
  it with the new filter. Reapplying the same binding does not restart the hook.
- `scripts/build-input-hook.mjs` applies `patches/uiohook-napi+1.5.5.patch` (`--patch-only` in
  `postinstall`) and compiles it. Compiling removes upstream's unfiltered prebuilds and marks our
  binaries; `electron-builder.cjs` refuses to package an architecture without that mark, and
  `npmRebuild: false` keeps electron-builder from replacing them. The Desktop workflow compiles
  every packaged architecture (`arm64 x64` on macOS); manually:
  `npm run build:input-hook -w @nexspeak/desktop -- x64` (or `arm64`, with a matching toolchain).
  Until then unit tests load upstream's unfiltered prebuilds, which accept but ignore the filter.
- `native-test/` compiles the actual patched dispatcher with simulated OS input and counts
  allocations and N-API submissions (no X11 headers or OS permissions needed); CI runs it on
  Linux. To compare real CPU use, profile Electron's main process during a call with push to talk
  while moving a 1000 Hz mouse, first with a keyboard binding, then with Mouse4. Both down/up
  pairs must still control the microphone; leaving the call must stop the hook.
- macOS needs the accessibility permission (the settings offer a button); until then, and on
  Wayland (no global hooks), the key only works while NexSpeak has the focus.
- Keys are stored as `KeyboardEvent.code` (physical key) or `Mouse3`–`Mouse5`.

## Screen sharing

`getDisplayMedia` goes to `setDisplayMediaRequestHandler`:

- macOS 15+: the system picker (ScreenCaptureKit), no picker of our own.
- Linux with Wayland: the desktop portal's picker.
- Otherwise (Windows, X11): `DesktopSourcePicker` from the web app; Windows also shares the system
  audio via loopback.

## Autostart

The setting "Start at login" (settings → account, desktop app only) is stored by the OS itself:
a login item on macOS and Windows (`app.setLoginItemSettings`), `~/.config/autostart/nexspeak.desktop`
on Linux (pointing at the AppImage file, not its temporary mount). Started that way, the app opens
in the tray only: Windows and Linux pass `--hidden`, macOS reports `wasOpenedAtLogin`. Unpackaged
dev runs do not offer the setting.

## Auto-update

`src/updater.ts` uses electron-updater with the `publish` target from `electron-builder.cjs` and
the `latest*.yml` files attached to each release.

- Checks 30 s after the start, then only when the window gets the focus and the last check is more
  than 6 hours ago. No timer runs while the app sits in the tray.
- Nothing downloads while the user is in a call (the download would compete with the call for
  bandwidth); it starts when the call ends.
- A downloaded update installs when the app quits, or right away from the "Restart now" notice
  (`DesktopUpdateNotice`) and the tray menu ("Restart to update"); both only appear outside a call.
- Windows (NSIS), Linux AppImage and deb (asks for the password via pkexec) update themselves.
  macOS only accepts updates signed with a Developer ID (#9); ad-hoc signed builds fail the update
  there and log the error.

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

## Nightly builds

`.github/workflows/nightly.yml` runs every night and builds only when `apps/`, `packages/` or the
lockfile changed since the last nightly and CI passed for that commit (by hand: "Run workflow",
optionally with "force"). It packages with `NEXSPEAK_CHANNEL=nightly`, which makes
`electron-builder.cjs` build "NexSpeak Nightly":

- Its own app id (`io.github.duell10111.nexspeak.nightly`), name, data folder, Linux executable and
  deep-link scheme (`nexspeak-nightly://`, also used for the SSO return), so it installs and runs
  next to the stable app. `src/channel.ts` reads the channel from the packaged `package.json`.
- Version `<next patch>-nightly.<date>.<run>`: above the last release, below the next one.
- Releases go to the separate repository `Duell10111/NexSpeak-nightly` as prereleases (drafts until
  all installers are attached), so release-please and the releases here stay untouched. The
  nightly app updates only from there; only the newest 7 nightlies are kept.

Setup: the repository needs at least one commit, and this repository the secret
`NIGHTLY_RELEASE_TOKEN` (fine-grained token, "Contents: read and write" on `NexSpeak-nightly`).

## Still open (milestone "Beta 0.2 – Desktop")

Developer ID signing and notarization and Windows code signing (#9; macOS auto-update depends on
it).
