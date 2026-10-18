# Desktop app

The desktop app is the web app in its own window, plus what a browser tab can't do. Install it as
described in [Installing](install.md).

## Tray

Closing the window keeps NexSpeak running in the tray (menu bar on macOS), like Discord, so a call
keeps going. The tray menu opens the window, mutes, deafens, leaves the call, checks for updates,
restarts for an update and quits NexSpeak. Quit with the tray menu or Cmd+Q.

Notifications appear as system notifications; a click brings the window back. Unread mentions,
direct messages and invites show as a badge on the dock icon (macOS), the taskbar (Windows) or the
launcher (Linux).

## Push to talk in games

The push-to-talk key works system-wide, so it also works while a game has the focus. NexSpeak only
listens for it while you are in a call with push to talk, never in the background. Setup and platform
notes: [Settings → Push to talk](settings.md#push-to-talk).

## Start at login

**Settings → Account → Start at login** starts NexSpeak in the tray when you log in to your
computer, without opening a window. You can also turn it off in your system's login items.

## Links

`nexspeak://` links open in the app, e.g. from a browser. matrix.to links in messages open the room or
person directly in NexSpeak. Nightly builds use `nexspeak-nightly://` ([Nightly builds](nightly.md)).

## Updates

The app updates itself and never during a call, see [Installing → Updates](install.md#updates).
To check right away, use **Check for updates** in **Settings → About**, or **Check for updates…** in
the tray menu or (macOS) the NexSpeak app menu.

## Resource use

NexSpeak runs next to games and is built to cost as little as possible: no work while the window is in
the background, hardware video encoding, and no spell checker downloads. Hardware acceleration always
stays on.
