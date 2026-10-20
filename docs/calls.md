# Calls and screen sharing

Every channel has a voice channel. Calls use MatrixRTC with LiveKit, so they work together with
Element Call. In encrypted channels the audio and video are end-to-end encrypted too.

## Joining and leaving

- **Double-click** a channel, or choose **Join voice channel** next to it. In direct messages, use
  **Start call**.
- The panel at the bottom left shows **Voice Connected** with the connection quality, plus **Video**,
  **Screen** and **Disconnect**.
- **Mute** and **Deafen** (next to your name) also work before you join.
- People in a voice channel are listed below it in the channel list.
- A short sound plays when you join or leave, when someone else joins or leaves, and when someone
  starts or stops a stream. Turn the sounds off in **Settings** → **Audio** → **Sound cues in
  calls**, see [Settings](settings.md#audio).
- Active calls show their duration on the right of the channel entry, as `M:SS` or `H:MM:SS`.
  It uses the oldest current MatrixRTC membership, including calls started in Element Call.
  The duration disappears when everyone leaves; the next call starts fresh.

The call view shows everyone as tiles with a speaking indicator. **Focus** a camera or screen share
to show it large, use **Full screen**, and **Show chat** to write next to the call.

## Volume of each person

Right-click a person in the call for **User volume**, or **Mute** them just for you (**Muted for
you**). This doesn't affect what others hear.

## Camera and screen sharing

**Video** turns your camera on and off. **Screen** opens the stream settings:

**Resolution** and **Frame rate**
: Up to the source resolution and 60 FPS. Pick 60 FPS for games; for text and code, 15 FPS at a high
  resolution is enough. The dialog shows how much upload bandwidth the choice needs.

**Go Live**
: Then choose the screen or window. In the browser, the browser asks; in the desktop app NexSpeak
  shows its own picker (macOS 15 and Wayland use the system's picker). On Windows the desktop app
  also shares the system audio.

While you stream, **Stream settings** changes the quality without stopping, and **Stop streaming**
ends it.

Your own stream tile doesn't show your screen by default ("Your stream is still running! We paused
the preview to save your resources."), so the preview costs no graphics card time while you play.
**Show preview** shows it, **Hide preview** (on the tile, or right-click it) pauses it again; the
choice is remembered on this device. While NexSpeak isn't the focused window (for example while you
play), or is minimized or hidden, the preview is always paused. Your viewers aren't affected.

### Watching a stream

Streams of others aren't downloaded until you choose to watch them: their tile shows **Live** and a
**Watch stream** button, and a notice tells you when someone went live. Watching shows the stream
large. **Stop watching** (on the tile, or right-click it) stops downloading it again, which saves
bandwidth and graphics card time while you play.

### Performance

NexSpeak encodes video with H.264 on the graphics card (macOS, Windows with NVIDIA, AMD or Intel,
Linux with VA-API), so streaming costs little CPU next to a game. **Stream info** shows whether the
hardware encoder is in use and whether the quality is limited by the CPU or your upload.

:::{note}
Firefox encodes video without the graphics card. For high resolutions at 60 FPS, use Chrome, Edge,
Safari or the desktop app, or pick 1080p at 30 FPS.
:::

## Connection details

Click **Voice Connected** for **Connection details**: ping over the last minute, packet loss in both
directions, the server, whether the connection goes through a TURN relay, and whether the call is
end-to-end encrypted.

## Who may join calls

Channels created in NexSpeak allow calls for everyone. Rooms created elsewhere (e.g. in Element)
often only let moderators and admins join calls; members then see "Calls aren't enabled for all
members of this room yet". Admins can change that with **Allow everyone** in the call, or with
**Everyone can join the voice channel** in **Channel settings**.

See [Troubleshooting](troubleshooting.md) if a call doesn't connect.
