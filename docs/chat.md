# Chat

## Messages

Hover over a message for its actions: **Add reaction**, **Reply**, **Create thread** /
**Open thread**, **Edit** and **Delete** (your own messages; moderators can delete others' too) and
**More** with **Copy text**, **Pin** and **Report message**.

- **Edit:** Escape cancels, Enter saves. Edited messages show **(edited)**.
- **Files:** attach them with the clip, drag and drop them into the chat, or paste them. Up to 100 MB;
  in encrypted channels files are encrypted too.
- **Emoji:** the emoji button in the message field, or reactions on messages, opens the same
  picker. **Search emoji** searches English and German names and keywords. Use **Emoji category**
  to browse a category and **Skin tone** to choose a variant; **All skin tones** includes mixed
  tones. Your skin tone and up to 32 **Frequently used** emoji are remembered on this device.
  Emoji use your system font, so newer characters may depend on your operating system.
- **Reactions:** choose **Add reaction**, then an emoji. The picker stays next to the message while
  you move the pointer to it. Escape closes it without adding a reaction.
- A message that failed to send can be **resent** or **discarded**.

## Formatting

NexSpeak understands Discord-style Markdown:

| Write | Result |
|---|---|
| `**bold**` | **bold** |
| `*italic*` or `_italic_` | *italic* |
| `__underline__` | underlined |
| `~~strike~~` | ~~strike~~ |
| `\|\|spoiler\|\|` | hidden until clicked |
| `` `code` `` | `code` |
| ` ```js ` … ` ``` ` | code block |
| `> quote` | quote |
| `- item` / `1. item` | lists |
| `# Heading` | heading |
| `[text](https://…)` | link |

A backslash (`\*`) shows a character as typed.

## Mentions

Type `@` to mention a person, `#` for a channel, and choose from the suggestions. `@room` notifies
everyone in the channel.

## Threads and pinned messages

- **Threads** keep side conversations out of the channel. Start one from a message (**Create
  thread**); **Threads** in the channel header lists all of them.
- **Pinned messages** (pin icon in the channel header) collect important messages. Pin them via
  **More → Pin**.

## Direct messages

**Direct Messages** at the top of the server list shows your conversations. **Start a direct
message** searches by name or takes a Matrix ID like `@alice:matrix.org`; choosing several people
starts a group. People you don't share a room with can only be found by their full Matrix ID.
Friends and friend requests are listed there as well, see [Friends](friends.md).

To leave a direct message or a room under **Rooms** that doesn't belong to a server, right-click it
(long press on touch screens) or use the **Leave** button in its header and confirm. A running call
there ends, and the conversation disappears from your list; you can only come back if someone
invites you again. Leaving a direct message with a friend also ends the friendship for both of you.

## Safety

- **Ignore** someone (in their profile or the member list): you won't see their messages, invites or
  notifications anymore, in any room. They aren't told. **Settings → Account** lists ignored people.
- **Report** a message or channel: the report goes to the admins of your homeserver. They can only
  read the message if it isn't encrypted.

## Server emoji

Open the emoji picker to find the current server's **Server emoji** section. Select
an emoji to insert its `:shortcode:` into the message. You can also type `:` followed
by its name, then choose a suggestion with the arrow keys and Enter or Tab.
The sent message contains the image and a text fallback for other Matrix clients.
Use **Add reaction** to select a server emoji as a reaction; click the reaction again
to remove it. Editing a message keeps its existing custom emoji.

Emoji use fixed-size, static thumbnails, including GIF and animated WebP uploads.
Images are fetched only when an emoji becomes visible; closing a picker releases its
contents. This avoids animation and image processing while gaming.
