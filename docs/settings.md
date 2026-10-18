# Settings

Open **Settings** with the gear next to your name at the bottom left. Your name opens **Profile and
status**.

## Profile

**Display name** and avatar apply in all rooms and servers. **Status**: **Online**, **Away** or
**Invisible** (you appear offline but can use everything as usual). Whether others see your status
depends on your homeserver.

## Audio

- **Input device** and **Output device**, **Call volume**, **Play test tone** and **Test
  microphone** with a level meter. Some browsers can't choose the output device.
- **Input mode**: **Voice activity** or **Push to talk**.

### Push to talk

Choose **Set key** and press a key or mouse button (mouse buttons 3–5 work too); Esc cancels.
**Release delay** keeps the microphone open briefly after you let go, so the end of a word isn't cut
off. Without a key nothing is sent.

- **In the browser**, push to talk only works while NexSpeak is in the foreground.
- **In the desktop app** the key works system-wide, also while a game has the focus. NexSpeak only
  listens for it while you are in a call.
  - macOS needs the accessibility permission: choose **Grant permission**.
  - On Linux with Wayland there are no global keys; the key only works while NexSpeak is in the
    foreground.

## Notifications

**Show notifications** and **Show message content**; in the browser, **Allow in browser** first.
Which rooms notify follows your Matrix settings, like in Element:

| Option | Notifies for |
|---|---|
| **Default** | What your account's settings say (usually direct messages and mentions) |
| **All messages** | Every message |
| **Only mentions** | Mentions of you and `@room` |
| **Muted** | Nothing |

Set it per channel with the bell in the channel header (or right-click the channel), or for a whole
server via the server menu → **Notifications for all channels**. Unread mentions also appear in the
window title and as a badge on the app icon.

## Security

Recovery key, device verification and key backup, see [Encryption](encryption.md).

## Account

- **Signed in as**, your device, and **Manage account (password, sessions)** on homeservers with the
  new Matrix login.
- **Language**: German or English. Without a choice, NexSpeak follows your browser or system.
- **Ignored people**.
- **Desktop app → Start at login** (desktop app only), see [Desktop app](desktop.md).
- **Log out**. Before that, make sure your keys are backed up, otherwise you can't read older
  encrypted messages afterwards.

## About

Version, the source code of this version, how to report bugs and the open source licenses NexSpeak
is built on. In the desktop app also the app version and channel, and **Check for updates**, see
[Installing → Updates](install.md#updates).
