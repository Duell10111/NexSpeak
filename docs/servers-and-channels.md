# Servers and channels

NexSpeak shows Matrix the way Discord is organized, and Element sees the same structure:

| NexSpeak | Matrix |
|---|---|
| Server | Space |
| Category | Sub-space |
| Channel (text and voice at once) | Room |
| Admin, Moderator, Member | Power levels 100, 50, 0 |

## Creating a server

1. Choose **Add a server** (the plus button in the server list), then **Create a server**.
2. Enter a **Name**. Optionally add a **Description** and an **Icon** (PNG, JPEG, GIF or WebP,
   up to 10 MB).
3. Choose **Create a server**. NexSpeak selects the new server and opens its **general** channel.

You are the admin. The server is invite-only; its general channel supports text and voice and is
open to server members. Use **Invite people** in the server menu to bring others in. The server is
a Matrix space, so it and its channel also appear in Element.

## Joining

- **Invites** appear in the channel list under **Invites**. Accepting a server invite joins all
  open channels of the server; private channels need their own invite.
- **Add a server → Join a server** in the server list joins a public space or room by its address, e.g.
  `#community:matrix.org` or a room ID.
- Links to rooms and people ([matrix.to](https://matrix.to) links) open directly in NexSpeak.
- New channels of a server you joined are joined automatically.

## Channels

Every channel is a text channel and a voice channel at once: write in it, or double-click it (or
choose **Join voice channel**) to talk. See [Calls](calls.md).

Right-click a channel for its menu: **Edit channel**, **Add members**, **Notifications**, **Report
channel** and, for admins and moderators, moving and deleting.

## Managing a server

The menu behind the server name (top of the channel list) has **Invite people**, **Server
settings**, **Notifications for all channels** and **Leave server**.

**Server settings**
: **Overview**: name, description and icon. **Permissions**: change someone's role, **Kick** them
  (they can come back with a new invite) or **Ban** them (they can't join again).

**Create channel** / **Create category**
: In the server menu, or right-click a category. Channel options:
  - **Private channel**: only members you add can see and join it.
  - **End-to-end encrypted**: can't be turned off later; new members can't read older messages.

**Channel settings**
: Name, topic and category, **Only moderators can send messages** (announcement channels) and
  **Everyone can join the voice channel** (otherwise only moderators and admins can start and join
  calls).

**Categories**
: Create, rename, reorder (**Move up** / **Move down**) and delete them. Deleting a category keeps its
  channels; they move out of the category.

:::{note}
Matrix rooms can't really be deleted. **Delete channel** removes the channel from the server for
everyone, removes all members and leaves it. This can't be undone.
:::

## Roles

What each role may do follows the Matrix power levels of the rooms; by default:

| Role | Can |
|---|---|
| Admin | Everything, including server settings and roles |
| Moderator | Manage channels and categories, remove members, send in announcement channels |
| Member | Write, react and join calls (where allowed) |

Roles apply to the whole server, in all of its channels.
