# Encryption

Direct messages and encrypted channels are end-to-end encrypted: only the people in the conversation
can read them, not your homeserver. Attachments and, in encrypted channels, calls are encrypted
too. NexSpeak uses the same encryption as Element, so both can read each other's messages.

Link previews in encrypted rooms are off by default and require a separate opt-in. If enabled,
the link is sent to your homeserver to request its preview, outside end-to-end encryption.
Custom status text is also public presence data. See [Settings](settings.md) and
[Link previews](chat.md#link-previews).

Every device you sign in on (browser, desktop app, Element on your phone) has its own keys. Two
things make sure you can read your messages everywhere:

## Recovery key

**Settings → Security → Create recovery key** creates keys to verify your devices and an encrypted
backup of your message keys on your homeserver. Your password is needed to confirm.

Keep the recovery key safe, e.g. in a password manager. Without it you can't read older encrypted
messages on new devices. New message keys are backed up automatically afterwards.

## Verifying a new device

A new device shows "This device is not verified". Verify it in **Settings → Security**:

- **Verify with recovery key**: enter the key; the device is verified and your message keys are
  restored.
- **Verify with another device**: accept the request in Element or NexSpeak on a device that is
  already signed in, then compare the emojis. They must be the same, in the same order. Choose
  **They match** only if they do.

Other people can verify you the same way; you then see "{user} wants to verify you".

## Logging out

Logging out deletes this device's keys. Check **Settings → Account** first: if no key backup is
active, set up a recovery key, otherwise you can't read older encrypted messages afterwards.
