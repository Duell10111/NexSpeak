# NexSpeak

NexSpeak is a Discord-like app for [Matrix](https://matrix.org): Matrix spaces appear as servers,
rooms as channels, and every channel is a text and a voice channel at once. It has direct messages,
voice and video calls, screen sharing up to 60 FPS and end-to-end encryption, and it is compatible
with Element: you can use both with the same account.

NexSpeak runs in the browser and as a desktop app for macOS, Windows and Linux. The desktop app adds
system-wide push to talk (also while a game has the focus), a tray icon, autostart and automatic
updates.

:::{figure} images/server-chat.png
:alt: NexSpeak showing the Weekend crew server, its channels, a conversation with reactions, and the member list.
:width: 100%

The main window: servers on the far left, channels beside them, the conversation in the middle and
members on the right. The screenshots in this guide use the English web app with sample accounts;
the desktop app shares the same interface.
:::

:::{tip}
New here? Start with [Getting started](getting-started.md). Want to try the newest features before a
release? See [Nightly builds](nightly.md).
:::

```{toctree}
:caption: Using NexSpeak
:maxdepth: 2

getting-started
install
servers-and-channels
chat
friends
calls
settings
encryption
desktop
nightly
troubleshooting
```

```{toctree}
:caption: Admins
:maxdepth: 2

hosting
homeserver
voice-moderation-design
```

```{toctree}
:caption: Project
:hidden:

Source code <https://github.com/Duell10111/NexSpeak>
Report a bug <https://github.com/Duell10111/NexSpeak/issues>
```

NexSpeak is free software under the
[AGPL-3.0-or-later](https://github.com/Duell10111/NexSpeak/blob/main/LICENSE). It has no tracking and
no analytics: it only talks to your homeserver and the call servers.
