# Servers and channels

NexSpeak shows Matrix the way Discord is organized, and Element sees the same structure:

| NexSpeak | Matrix |
|---|---|
| Server | Space |
| Category | Sub-space |
| Channel (text and voice at once) | Room |
| Admin, Moderator, Member | Power levels 100, 50, 0 |
| Custom roles | Power levels in between, names and colors only in NexSpeak |

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
: **Overview**: name, description and icon. **Roles**: the server's [roles](#roles).
  **Permissions**: the server's default [permissions](#permissions). **Members**: change someone's
  roles, **Kick** them (they can come back with a new invite) or **Ban** them (they can't join
  again).

  Admins can choose **Repair permissions** in **Overview** for servers with older channels or
  categories. This restores admin-only access to role settings, history visibility, encryption,
  room upgrades and homeserver access rules throughout the server. Roles, message permissions,
  call permissions and stricter existing restrictions are preserved. Only rooms that need a change
  are updated; nothing is migrated automatically. The result reports any rooms that could not be
  checked or repaired (for example, private channels you have not joined). You can retry after
  joining those rooms or obtaining the required permissions.
  A running repair continues if you switch tabs or close the settings. Reopening **Overview**
  shows its progress and prevents starting another repair until it finishes.

**Create channel** / **Create category**
: In the server menu, or right-click a category. Channel options:
  - **Private channel**: only members you add can see and join it.
  - **End-to-end encrypted**: can't be turned off later; new members can't read older messages.

**Channel settings** / **Category settings**
: **Overview**: name and topic (and the icon of a channel). **Permissions**: see
  [Permissions](#permissions).

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

Roles apply to the whole server, in all of its channels. Someone can hold several roles; they
get the permissions of the highest one.

**Custom roles**
: In **Server settings → Roles**, choose **Create role**. A new role starts right above Member.
  Give it a name, a color (shown on member names) and choose whether to **Show separately in the
  member list**. Move roles with the arrows: roles higher in the list rank above lower ones. A
  custom role can sit above or below Moderator, but always below Admin. Admin, Moderator and
  Member are built in; you can change their color and grouping but not move or delete them.

  Each role has a level between those of the built-in roles (shown as **Level …**), and NexSpeak
  picks it from the role's position. Moving a role changes its level: members with that role and
  permissions set to it move along. Deleting a role gives its permissions to the next higher role,
  and its members fall back to their next lower role.

**Assigning roles**
: In **Server settings → Members** or by clicking someone in the member list, open the role
  picker next to their name and tick the roles they should have. You can only change people below your own role and only
  give roles up to your own.

**Member list**
: Members are grouped by their highest role that is shown separately (by default Admin and
  Moderator); everyone else is listed under **Online**, and offline members are listed together.
  The highest role with a color colors the name.

:::{note}
Matrix only knows the power level. Element and other clients see the level (e.g. 75) but not the
role names, colors or groups. If someone's level is changed in another client, NexSpeak shows the
role that matches the new level.
:::

## Permissions

The **Permissions** tab exists in the server settings and in the settings of every category and
channel. Matrix compares each permission with a role's power level, so you choose the lowest role
that may do something: that role and every role above it have the permission.

At the top are shortcuts for the most common settings: **Private channel** (channels only), **Only
moderators can send messages** (announcement channels) and **Everyone can join the voice channel**
(otherwise only moderators and admins can start and join calls). **All permissions** lists every
permission:

| Permission | Default |
|---|---|
| Send messages and reactions | Member |
| Join the voice channel | Member |
| Mention @room | Moderator |
| Invite people | Member |
| Pin messages | Moderator |
| Edit name, topic and icon | Moderator |
| Delete messages of others | Moderator |
| Kick members | Moderator |
| Ban members | Moderator |

A level that matches no role (set by another client, for example) shows as **Custom (level …)**
until you pick a role. You can't give a permission to roles above your own or change a permission
that is above your own role. The editor never changes who may change roles and permissions.

**Synced with the category**
: Like on Discord, a channel follows the permissions of its category, and a category or a channel
  without a category follows the server. The tab shows **Synced with …** while all permissions
  match. Saving the category (or the server's defaults) then updates every synced channel as well;
  the confirmation shows how many. Change a channel on its own and it shows **Custom
  permissions**: later changes to the category no longer apply to it. **Sync with …** takes over
  the category's permissions again.

  New channels start with the permissions of their category. A synced channel moved to another
  category follows the new one; a channel with custom permissions keeps them. Deleting a category
  keeps the permissions of its channels.

Matrix has no inheritance, so each synced room gets its own update (one per room). Element shows
the same permissions in a room's **Roles & Permissions** settings.

## Managing server emoji

Open the server menu, choose **Server settings**, then **Server emoji**. Moderators
and administrators who can change the server's emoji state can upload images, edit
their shortcodes with **Save**, and remove them with **Delete**. Members can view the
list but cannot change it.

Enter an **Emoji shortcode**, then choose **Upload emoji**. PNG, JPEG, GIF and WebP
images up to 2 MiB are accepted. Use up to 100 letters, digits, hyphens or underscores
in the name. Names must be unique within the pack. Renaming and deleting update the
server's `im.ponies.room_emotes` Matrix state, so other compatible clients can use the
same images. Previously sent emoji remain visible after deletion.

In the same settings, select **Stickers**, enter a **Sticker name**, and choose
**Upload sticker**. The same file formats, size limit and name rules apply. Stickers
can be renamed with **Save** and removed with **Delete**, just like emoji. Images are
marked with their intended usage in the shared pack; existing images and metadata
from other clients are preserved. Images without a marked usage, such as emoji uploaded
before stickers were available, count as both emoji and sticker and appear in both lists.
Deleting such an image from one list keeps it in the other; renaming it changes both. Animated stickers play in chat only while visible
and the window is focused. The settings list uses static previews.

Emoji images and their pack state are shared with the homeserver and are not
end-to-end encrypted, even when used inside an encrypted channel.

## Server soundboard

In **Server settings → Soundboard**, moderators and admins can choose **Upload sound** to add
an Opus/OGG or MP3 recording of at most five seconds and 512 KB. A server can have up to 32 sounds.
Give each sound a **Sound name**, **Sound emoji**, and **Volume**, then choose **Save**. Choose
**Remove sound** to remove it from the catalog. Only upload recordings you have permission to share.

Everyone in a call can play the server's sounds from the **Soundboard** button. The catalog is
stored in the server space as `io.nexspeak.soundboard`; other Matrix clients can ignore it.
