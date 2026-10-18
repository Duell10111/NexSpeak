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

## First steps

- **Set up encryption:** open **Settings → Security** and create a recovery key, or verify this
  device with another one. Without it you can't read older encrypted messages on new devices. See
  [Encryption](encryption.md).
- **Join a server:** choose **Join a server** in the server list and enter an address
  like `#community:matrix.org`, or accept an invite under **Invites**.
- **Write to someone:** open **Direct Messages** at the top of the server list and choose **Start a
  direct message**.
- **Check your microphone:** **Settings → Audio** has device selection, a microphone test and push
  to talk.
