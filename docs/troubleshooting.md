# Troubleshooting

## Sign-in

If your saved sign-in data is unreadable, NexSpeak treats you as signed out instead of reusing a
previously loaded session. Sign in again to save a valid session.

## Calls

"Your homeserver doesn't offer voice channels"
: Your homeserver has no call service (MatrixRTC with LiveKit). Ask its admins; homeservers with
  Element Call, like matrix.org, have one.

"Discovering the voice service timed out. Please try again."
: The service lookup did not finish within ten seconds. Check your connection and try joining
  again; the next attempt starts a fresh lookup.

"You aren't allowed to join calls in this room" / "Calls aren't enabled for all members of this room yet"
: Only moderators and admins may join calls in this room. An admin can allow calls for everyone, see
  [Who may join calls](calls.md#who-may-join-calls).

"Access denied. Please allow microphone, camera or screen sharing in your browser."
: Allow the permission in the site settings of your browser. On macOS, also check **System Settings →
  Privacy & Security → Microphone / Camera / Screen Recording** for your browser or NexSpeak.

You don't hear anyone
: The browser may have blocked playback: click the hint "The browser blocked playback". Also check
  the output device and **Call volume** in **Settings → Audio**, and whether you are deafened.

Others don't hear you
: Check the input device with **Test microphone**. With **Input sensitivity**, the test shows whether
  your voice is above the threshold; move it further left if not. With push to talk, check that a key
  is set. On macOS, the key only works in games with the accessibility permission.

Other apps become quieter when you join a call
: Opening **Settings → Audio** does not activate the microphone. If the volume changes when you
  join a call or choose **Test microphone**, the browser or operating system may be changing its
  audio processing or device mode.

  On macOS, Firefox and Safari can briefly fade other audio when initializing system voice
  processing, particularly with the built-in microphone and speakers. If this happens in Firefox
  but not Chrome, it matches the behavior in
  [Mozilla's browser bug report](https://bugzilla.mozilla.org/show_bug.cgi?id=2054983).
  Firefox 156 includes a change that avoids forcing system voice processing for the built-in
  microphone when all capture processing is disabled. This does not mean that calls with echo
  cancellation enabled are unaffected. Update Firefox first. For a comparison with headphones,
  turn off **Echo cancellation** and **Automatic gain control**, set **Noise suppression** to
  **Off** in **Settings → Audio**, then start a fresh **Test microphone**. Restore your preferred
  settings afterward; use echo cancellation with speakers to prevent feedback. Older Firefox
  versions can still initialize system voice processing even with these options off.
  Compare with Chrome or external audio devices if the problem persists. Include your Firefox
  version, macOS version and input/output devices when reporting it. To narrow down a remaining
  call-start fade, fully quit and reopen Firefox, then compare the first call join with
  **Test microphone** using the same devices and voice processing settings. Repeat with capture
  processing disabled as above, and note whether the fade happens only on first microphone access
  or on every access.

  NexSpeak applies processing changes to the running microphone where supported, avoiding an
  additional device open. This reduces avoidable microphone initialization; it cannot disable
  macOS ducking inside Firefox or guarantee a fade-free first microphone access. With headphones,
  **Enhanced (RNNoise)** can retain noise suppression while the browser's **Echo cancellation**
  and **Automatic gain control** are off; RNNoise replaces browser noise suppression.

  On Windows, the system can lower other apps when it detects communication activity. Check
  **Sound Control Panel → Communications → Do nothing**; see Microsoft's
  [default ducking documentation](https://learn.microsoft.com/en-us/windows/win32/coreaudio/stream-attenuation).
  This is a system-wide preference. If the sound also changes quality when using a Bluetooth headset,
  compare with a separate microphone or a wired headset to check whether opening the headset
  microphone triggers a device mode switch.

"You joined this call on another device."
: You are in the same call with another device or app (e.g. the nightly and the stable app). Leave it
  there.

Choppy screen sharing
: **Stream info** shows whether the CPU or your upload limits the stream. Pick a lower resolution or
  frame rate; in Firefox, see the note in [Calls](calls.md#performance).

## Encryption

"Unable to decrypt message"
: This device doesn't have the key for the message. Verify the device with your recovery key or
  another device ([Encryption](encryption.md)). Messages from before you joined an encrypted channel
  can't be read.

## Desktop app

The app doesn't open on macOS / Windows warns
: The builds aren't signed yet, see [Unsigned builds](install.md#unsigned-builds).

Push to talk doesn't work in games
: macOS: grant the accessibility permission in **Settings → Audio**. Linux with Wayland has no global
  keys.

## Reporting a bug

Report bugs in the [issue tracker](https://github.com/Duell10111/NexSpeak/issues) with your version
(**Settings → About**), platform and, for calls, the homeserver.

For detailed logs in the web app, run `localStorage.setItem("nexspeak:debug", "1")` in the browser
console and reload; NexSpeak and LiveKit then log verbosely.

When investigating microphone initialization, entries starting with `[call] microphone capture`
show the requested and reported echo cancellation, noise suppression and automatic gain control,
plus the reported sample rate and channel count. They are emitted on microphone enablement,
processing changes and input device selection; there is no background polling. These entries do
not include microphone audio, device names or device IDs. Some browsers omit individual reported
settings. Include the entries alongside the browser/OS versions and your input/output setup when
reporting a fade. A reported setting confirms the capture configuration, not the volume of other
apps. Remove the flag with `localStorage.removeItem("nexspeak:debug")` and reload after testing.

For slow call joins, run `localStorage.setItem("nexspeak:callTimings", "1")` in the console before
joining. Entries starting with `[call timing]` show each phase's duration and the elapsed time
since the join started: membership loading, service discovery (only when needed), OpenID,
token exchange, connection, and microphone readiness (including the encryption key and audio
processing). Discovery and OpenID run in parallel, so their durations should not be added together.
Microphone readiness is omitted when joining muted. Timings contain no tokens, room ids or service
URLs. Disable them with `localStorage.removeItem("nexspeak:callTimings")` before the next join.

Joining an existing call uses the service advertised by its oldest member without looking up
your own service. That service must use HTTPS (plain HTTP only on `localhost`), because it
receives your OpenID token; otherwise NexSpeak looks up your own service. When discovery is
needed, a successful result is reused for five minutes in the current Matrix client; failed
lookups are retried on the next attempt, and a cached service is dropped as soon as joining
through it fails. A lookup has a ten-second deadline across all discovery methods, and pending
requests are aborted when it expires. If a call starts while discovery is running, NexSpeak
rechecks its oldest membership before choosing the service. The OpenID token is reused until
shortly before it expires and dropped when a service rejects it. No discovery runs while idle.
