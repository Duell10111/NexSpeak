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

To check right away, open **Settings → About** and click **Check for updates**, or pick **Check for
updates…** in the tray menu or (macOS) the NexSpeak app menu, which opens the same place. About shows
the app version, the channel (Stable or Nightly) and the update status: checking, up to date,
downloading, **Restart to update** once it is ready, or why the check failed (no network, an unsigned
macOS build, or a Linux package that can't update itself). An update found during a call downloads
after the call. When you are logged out, the menu shows the result as a system notification.

## Uninstalling

- **macOS:** move NexSpeak from Applications to the Trash.
- **Windows:** **Settings → Apps → NexSpeak → Uninstall**.
- **Linux:** delete the AppImage, or `sudo apt remove nexspeak`.

Your account and messages stay on your homeserver.
