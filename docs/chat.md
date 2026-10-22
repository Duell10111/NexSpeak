# Chat

## Messages

Hover over a message for its actions: **Add reaction**, **Reply**, **Create thread** /
**Open thread**, **Edit** and **Delete** (your own messages; moderators can delete others' too) and
**More** with **Copy text**, **Pin** and **Report message**.

- **Edit:** Escape cancels, Enter saves. The editor stays open while saving and keeps your draft if
  saving fails, so you can retry or cancel. Edited messages show **(edited)**.
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

## Audio and video

Audio and video attachments have an inline player. Choose **Play** to load the file,
then use the browser's playback, volume and seek controls. Videos show a preview when
the sender includes one. **Download** remains available, including for formats your
browser cannot play.

Full media files are downloaded and encrypted files are decrypted only after you choose **Play**
or **Download**. Playback stops and its media buffers are released when the attachment
scrolls out of view, you switch channels or the window becomes hidden. Choose **Play**
again to reload the file.

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

:::{figure} images/chat-thread.png
:alt: A channel conversation with emoji reactions and an open Thread panel containing replies to a game-night message.
:width: 100%

A thread opens beside the channel conversation. Replies stay in the thread, while the original
message shows its reply count. Emoji reactions appear below the message.
:::

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

- **Ignore** someone (in their profile or the member list): you won't see their messages, invites,
  notifications or typing indicators anymore, in any room. Typing indicators update as soon as you
  ignore or unignore someone, including from another device. They aren't told. **Settings → Account**
  lists ignored people.
- Ignoring also hides their text from reply quotations, thread previews and pinned-message previews.
  Threads they started disappear from the thread list. Already open lists update when the ignore
  list changes; unignoring restores previews for messages that are still loaded.
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

## Stickers

Open the emoji button in the message field and select **Stickers**. **Search stickers**
finds stickers by name, description or pack name. Select one to send it immediately;
text already in the message field stays as a draft. Stickers also work in replies and
threads. The reaction picker continues to use emoji.

The sticker tab includes the current server's packs, your personal Matrix sticker pack
and room packs enabled globally in a compatible Matrix client. NexSpeak reads these
from your synced account data; personal pack management stays in that client.
Server moderators can add stickers under **Server settings → Server emoji → Stickers**.

Stickers sent by other Matrix clients appear directly in the timeline, without a
message bubble or download controls, at a maximum of 200 × 200 pixels. Hover over a
sticker for its description. Picker results are virtualized and images load only when
visible. Animated stickers play only while visible and the window is focused; otherwise
a static thumbnail is shown. Stickers larger than 4 MiB always show the static thumbnail. Pack images are shared with the homeserver and are not
end-to-end encrypted, including when sent in an encrypted channel.

## Polls

Choose **Create poll** next to the message field. Enter a **Question** and 2–20 answers;
**Add answer** adds another option. Enable **Allow multiple answers** if people may
select more than one option, or **Hide results until the poll ends** to reveal the
results only after closing the poll. Poll creation is available in the main channel
or direct message, outside threads.

Select an answer and choose **Vote**. You can choose different answers and use
**Change vote**; only each person's latest response counts. Disclosed polls show
live vote counts. For hidden results, your own selection remains visible until the
poll ends. The creator and moderators can choose **End poll** to close voting and
reveal the final results.

Polls use Matrix polls and work with compatible clients such as Element. In encrypted
rooms the question, responses and end event are encrypted by the Matrix SDK. Counts
reflect the responses already loaded with the room's timeline; loading more history
can fill in older responses. Opening a poll does not fetch a separate response history.

## Message search

Select **Search messages** in a channel or direct message header. Enter **Search text**,
choose **Search in** (**Current channel or DM**, **Current server**, or **Direct messages**),
and select **Search**. Narrow the search by **Channel or conversation**, **Author (Matrix ID)**,
**From date** (inclusive), **Before date** (exclusive), or **Contains** (**Link** or **Attachment**).

Search uses your homeserver and covers only joined, unencrypted rooms. Encrypted messages
are excluded, including encrypted direct messages. NexSpeak does not keep a local search
index. Opening the panel does not start a search. Your homeserver determines which words
match and how far back its searchable history goes.

Results are grouped by channel or conversation. **Load more results** requests another page;
a page may have no matches after applying your filters. **Jump to message** opens the room
and loads the surrounding messages without downloading its entire history. Scroll upwards
to load older messages, or choose **Return to latest messages** to resume the live timeline.

Jumping to an unloaded thread reply requires homeserver support for forward thread
pagination. On older homeservers, open the thread from **Threads** instead. This avoids
automatically downloading an entire thread when opening one search result.
