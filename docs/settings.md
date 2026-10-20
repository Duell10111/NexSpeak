# Settings

Open **Settings** with the gear next to your name at the bottom left. Your name opens **Profile and
status**.

## Profile

**Display name** and avatar apply in all rooms and servers. **Status**: **Online**, **Away** or
**Invisible** (you appear offline but can use everything as usual). Whether others see your status
depends on your homeserver.

## Audio

- **Input device** and **Output device**, **Call volume** and **Play test tone**. Some browsers can't
  choose the output device.
- **Input mode**: **Voice activity** or **Push to talk**.
- **Voice processing**: noise suppression, echo cancellation and automatic gain control, see
  [below](#voice-processing).
- **Test microphone** records for five seconds with your current input mode and voice processing and
  shows the level.
- **Sound cues in calls**: short sounds when you join or leave, when others join or leave, and when
  a stream starts or stops. Turn them all off, or each one (**When you join or leave**, **When
  others join or leave**, **When a stream starts or stops**). They play on the output device at the
  call volume, and not while you are deafened.

### Voice activity and input sensitivity

With **Voice activity**, everything your microphone picks up is sent. Turn on **Input sensitivity** to
send only while you are louder than the threshold (in dB; further left is more sensitive). It stays
open for a moment after you stop, so word endings and short pauses aren't cut off. **Test microphone**
marks the threshold on the level meter and shows whether you would be sent (**Transmitting**) or not
(**Below the threshold – not transmitted**). Others don't see you as muted while the threshold holds
you back.

### Voice processing

**Noise suppression**:

| Option | What it does |
|---|---|
| **Standard (browser)** | The browser's built-in suppression (the default). |
| **Enhanced (RNNoise)** | Filters keyboard, fan and background noise more strongly with [RNNoise](https://github.com/xiph/rnnoise). Replaces the browser's suppression. |
| **Off** | No suppression, e.g. for music or a studio microphone. |

**Echo cancellation** and **Automatic gain control** are on by default; turn echo cancellation off
only with headphones. Changes also apply to a running call; switching echo cancellation or gain
control reopens the microphone for a moment.

Enhanced suppression and input sensitivity only run during a call (and the microphone test), on the
browser's audio thread, and pause while you are muted. Measured cost (Apple M1 Max, one 48 kHz
microphone):

| Mode | CPU (one core) |
|---|---|
| **Standard (browser)** | Part of the browser's audio processing, no extra cost |
| **Enhanced (RNNoise)** | about 1 % (about 1.6 % on CPUs without SIMD in WebAssembly) |
| **Input sensitivity** | about 0.01 % |

RNNoise needs the microphone at 48 kHz. Firefox can't convert other sample rates; there, enhanced
suppression falls back to no suppression with a microphone at e.g. 44.1 kHz.

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
