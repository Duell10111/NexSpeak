# Installing the desktop app

The desktop app is available for macOS (Apple Silicon and Intel), Windows and Linux. Download it from
the [releases page](https://github.com/Duell10111/NexSpeak/releases):

| Platform | File |
|---|---|
| macOS | `.dmg` (or `.zip`) |
| Windows | `NexSpeak-Setup-….exe` |
| Linux | `.AppImage` (any distribution) or `.deb` (Debian, Ubuntu) |

:::{note}
Want the newest changes before a release? [Nightly builds](nightly.md) install next to the stable
app.
:::

## Unsigned builds

The builds are not code-signed yet, so the operating system warns on the first start:

macOS
: Gatekeeper blocks the first start. Open the app via **System Settings → Privacy & Security → Open
  Anyway**, or run `xattr -dr com.apple.quarantine /Applications/NexSpeak.app` in the Terminal.

Windows
: SmartScreen warns about an unknown publisher. Choose **More info → Run anyway**.

Linux
: Make the AppImage executable (`chmod +x NexSpeak-*.AppImage`) or install the `.deb` with
  `sudo apt install ./nexspeak_*.deb`.

## Updates

The desktop app updates itself (Windows, Linux AppImage and `.deb`). It checks shortly after the
start and then every few hours when you bring the window to the front. It never downloads or
installs anything during a call. When an update is ready, NexSpeak shows **Restart now**; otherwise
it installs the next time you quit the app. On macOS, automatic updates only work with signed
builds; until then, install new versions by hand.

## Uninstalling

- **macOS:** move NexSpeak from Applications to the Trash.
- **Windows:** **Settings → Apps → NexSpeak → Uninstall**.
- **Linux:** delete the AppImage, or `sudo apt remove nexspeak`.

Your account and messages stay on your homeserver.
