# Getting started

## What you need

- **A Matrix account.** Any homeserver works, e.g. [matrix.org](https://matrix.org) or the server of
  your community or company. Your account and messages stay on your homeserver; NexSpeak is only the
  app you use to reach them.
- **For voice channels**, the homeserver has to offer a call service (MatrixRTC with LiveKit), the
  same one Element Call uses. matrix.org and most servers with Element Call have it. Without it, chat
  works but joining a voice channel shows "Your homeserver doesn't offer voice channels".

Use NexSpeak in the browser (on a site where it is hosted, see [Self-hosting](hosting.md)) or
[install the desktop app](install.md).

## Sign in

1. Enter your **Homeserver**, e.g. `matrix.org` or `https://matrix.example.com`.
2. Sign in the way your homeserver offers:
   - **Username and password** (`alice` or `@alice:matrix.org`). Your password is only sent to your
     homeserver.
   - **Continue with SSO** or with a named provider: you log in on the provider's page.
   - **Continue with {server}** on homeservers with the new Matrix login (e.g. matrix.org): you sign in
     on your homeserver's page and come back automatically. **Create account** registers a new account
     there.

In the desktop app, SSO and the new login open in your default browser; NexSpeak opens again by
itself afterwards.

No account yet? Choose **Create one** below the login form, or **Create account** on homeservers
with the new login.

For **Continue with {server}**, finish signing in in the same browser tab within 15 minutes. If
the login expires, start again from NexSpeak's login page.

:::{figure} images/sign-in.png
:alt: NexSpeak's sign-in screen with Homeserver, Username and Password fields and a Sign in button.
:width: 100%

Signing in with a username and password on the local example homeserver. The available sign-in
options depend on your homeserver.
:::

## First steps

- **Set up encryption:** open **Settings → Security** and create a recovery key, or verify this
  device with another one. Without it you can't read older encrypted messages on new devices. See
  [Encryption](encryption.md).
- **Create a server:** choose **Add a server → Create a server** in the server list. Enter a name;
  NexSpeak creates a server with a **general** channel for text and voice.
- **Join a server:** choose **Add a server → Join a server** in the server list and enter an address
  like `#community:matrix.org`, or accept an invite under **Invites**.
- **Write to someone:** open **Direct Messages** at the top of the server list and choose **Start a
  direct message**.
- **Check your microphone:** **Settings → Audio** has device selection, a microphone test and push
  to talk.

## Switch between conversations

Press **Ctrl+K** (**Cmd+K** on macOS) to open **Quick switcher** while NexSpeak is focused.
Search the names of your joined servers, channels and direct messages; partial or abbreviated names
work too. Channel results also show their server, unread messages and mentions.

With the search empty, recently visited destinations appear first. Use **Up** and **Down** to choose
a result, then **Enter** to open it, or click a result. **Esc** closes the switcher. It searches the
rooms already loaded in NexSpeak without contacting a directory, and does not run in the background.
