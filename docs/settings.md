# Settings

Open **Settings** with the gear next to your name at the bottom left. Your name opens **Profile and
status**.

## Profile

**Display name** and avatar apply in all rooms and servers. **Status**: **Online**, **Away**,
**Do not disturb** or **Invisible** (you appear offline but can use everything as usual).
Whether others see your presence depends on your homeserver.

**Do not disturb** is remembered on this device. It silences system notifications and alert
sounds locally; unread messages and mentions still count. Matrix has no standard DND presence,
so other clients see you as online. It does not mute the people speaking in a call.

Set a **Custom status** to share a short text, including emoji, on member cards and in the
member list. Choose **Clear after**: **30 minutes**, **1 hour**, **4 hours**, **Today** (local
midnight), or **Never**. Status text uses Matrix presence and is visible outside encrypted
conversations too; it is not end-to-end encrypted. Automatic clearing works while NexSpeak is
running, or when you next sign in on this device if the deadline passed while it was closed.

## Audio

:::{figure} images/audio-settings.png
:alt: Settings with the Audio tab selected, showing the microphone device, input mode, input sensitivity and voice processing.
:width: 512px

**Settings → Audio** groups device selection, input mode and voice processing. Scroll down in the
dialog for the microphone test and sound settings. Output selection depends on browser support.
:::

- **Input device** and **Output device**, **Call volume** and **Play test tone**. Some browsers can't
  choose the output device. Opening settings and refreshing the device list do not activate the
  microphone. If your browser hides device names, use **Test microphone** and grant access, or join
  a call; the device list then refreshes.
- **Input mode**: **Voice activity** or **Push to talk**.
- **Voice processing**: noise suppression, echo cancellation and automatic gain control, see
  [below](#voice-processing).
- **Test microphone** shows your microphone level with the selected voice processing until you choose
  **Stop microphone test**. Changes apply while testing; the level meter keeps working when you
  switch **Input sensitivity** on or off. Stopping the test, closing the settings, switching settings
  tabs or a processing error releases the microphone immediately.
- **Share system audio**: include sound when starting a screen share. The choice is remembered and
  applies to the next share. Available on Windows and macOS 13+ in the desktop app; browser support
  depends on the browser and capture source. See [Calls and screen sharing](calls.md).
- **Sound cues in calls**: short sounds when you join or leave, when others join or leave, when
  a stream starts or stops, and when someone starts or stops watching your stream. Turn them all
  off, or each one (**When you join or leave**, **When others join or leave**, **When a stream
  starts or stops**, **When someone watches your stream**). They play on the output device at the
  call volume, and not while you are deafened.

- **Soundboard**: enable or disable sounds played by call participants, and adjust their **Volume**
  independently of call sound cues. Deafening also stops them.

### Voice activity and input sensitivity

With **Voice activity**, everything your microphone picks up is sent. Turn on **Input sensitivity** to
send only while you are louder than the threshold (in dB; further left is more sensitive). It stays
open for a moment after you stop, so word endings and short pauses aren't cut off. **Test microphone**
marks the threshold on the level meter and shows whether you would be sent (**Transmitting**) or not
(**Below the threshold – not transmitted**). Others don't see you as muted while the threshold holds
you back. Leave the test running while adjusting the slider: set the threshold above background noise
but below your normal speaking level. Moving it left makes it more sensitive; moving it right blocks
quieter sounds. The marker and transmission status update without restarting the test.

### Voice processing

In a running call, changes to the browser's echo cancellation, noise suppression and automatic gain
control are applied to the existing microphone track where supported. NexSpeak reopens the device
only if the browser rejects or ignores the change. The browser or operating system may still
reconfigure its voice processing, see [other apps becoming quieter](troubleshooting.md#calls).

**Noise suppression**:

| Option | What it does |
|---|---|
| **Standard (browser)** | The browser's built-in suppression (the default). |
| **Enhanced (RNNoise)** | Filters keyboard, fan and background noise more strongly with [RNNoise](https://github.com/xiph/rnnoise). Replaces the browser's suppression. |
| **Off** | No suppression, e.g. for music or a studio microphone. |

**Echo cancellation** and **Automatic gain control** are on by default; turn echo cancellation off
only with headphones.
Transmission pauses while a voice processor is replaced, including while RNNoise loads.

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
  - On Linux with Wayland there is no global push-to-talk input hook; the key only works while NexSpeak is in the
    foreground.

### Global call shortcuts (desktop)

Under **Global call shortcuts**, next to the push-to-talk settings, assign a key or combination for
**Toggle mute**, **Toggle deafen**, **Leave call** or **Stop screen sharing**. Choose **Set key**
(or **Change key**), hold any modifiers and press the final key. Esc cancels; **Clear** removes a
binding. The assignments are saved on this device. This section is hidden in the browser.

All bindings start unassigned. They work in other apps, including games, only during a call.
NexSpeak releases them when the call ends, and temporarily releases them while you record a new
binding. **Stop screen sharing** only stops an existing share; it never starts one or opens a picker.

A shortcut combines a letter, number, numpad digit or navigation key with Ctrl, Alt or Cmd/Super;
function keys (F1 to F24) also work alone. During a call the combination is taken from every other
app, so a single letter would no longer type anywhere. Punctuation keys are not supported, because
they sit in different places on different keyboard layouts.

Duplicate shortcuts and combinations overlapping the push-to-talk key are rejected. For example,
if push to talk uses M, Ctrl+Shift+M conflicts too, since holding M would also open the microphone.
If the operating system or another app reserves a combination, a warning appears during a call;
choose another combination. Outside calls, availability cannot be checked without reserving keys.
On Wayland, global call shortcuts depend on your desktop's Global Shortcuts portal and its consent
settings; this is separate from the push-to-talk input hook.

#### Choosing useful shortcuts

These are suggestions to assign yourself, not preconfigured bindings. Use Cmd instead of Ctrl on
macOS, and choose alternatives if a game or another app already uses them.

| Action | Suggested combination | Purpose |
|---|---|---|
| Toggle mute | Ctrl+Shift+M | Briefly talk to someone outside the call |
| Toggle deafen | Ctrl+Shift+D | Silence the call and your microphone to focus on the game |
| Leave call | Ctrl+Alt+Shift+H | Disconnect without switching away from a game |
| Stop screen sharing | Ctrl+Alt+Shift+S | Quickly stop showing private information |

The mute/deafen suggestions follow [Discord's documented call shortcuts](https://discord.com/blog/how-to-navigate-discord-using-only-your-keyboard).
The disconnect and stop-sharing combinations are NexSpeak suggestions. Discord also documents
[Push To Mute and Toggle VAD](https://support.discord.com/hc/en-us/articles/217083547-How-do-I-add-different-Keybinds).
Push to mute would need reliable key-release tracking and another input-hook mode; switching
between voice activity and push to talk can unexpectedly change when the microphone transmits.
These are candidates for future work. Channel navigation and the quick switcher belong to app
navigation rather than system-wide call bindings (quick switcher: #44).

## Video

Choose **Camera** to remember the device used for previews and calls. Changing it also switches an
active call camera. If the selected camera is disconnected, NexSpeak falls back to **System default**.
Before camera permission is granted, device names may be hidden.

**Start camera preview** requests camera access and displays the selected camera without joining a
call. **Stop camera preview**, closing Settings or switching to another tab releases the preview
immediately. An active call keeps its own camera track. NexSpeak never opens the camera just to
list devices, and the preview is off each time you open Settings.

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

Selecting **All messages**, **Only mentions** or **Muted** activates that mode even if another Matrix
client previously disabled the matching notification rule.

## Messages

**Show link previews** is off by default. **Also preview links in encrypted rooms** needs a
separate opt-in. Preview requests reveal the link to your homeserver, including links from
encrypted messages. See [Link previews](chat.md#link-previews).

### GIFs

- **GIF search (KLIPY)**: lets the GIF picker search KLIPY. Off by default, because your search
  terms and IP address are sent to KLIPY, see [GIFs](chat.md#gifs).
- **Play GIFs automatically**: on, GIFs play while they are visible and the window is focused. Off,
  they play only while you hover over them or after you click them.

Both settings apply to this browser or desktop app only.

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
