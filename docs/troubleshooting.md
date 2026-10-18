# Troubleshooting

## Calls

"Your homeserver doesn't offer voice channels"
: Your homeserver has no call service (MatrixRTC with LiveKit). Ask its admins; homeservers with
  Element Call, like matrix.org, have one.

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
: Check the input device with **Test microphone**. With push to talk, check that a key is set. On
  macOS, the key only works in games with the accessibility permission.

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
