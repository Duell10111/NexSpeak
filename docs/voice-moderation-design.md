# Voice moderation: implementation prerequisites

Status: investigation for [#46](https://github.com/Duell10111/NexSpeak/issues/46), checked on
2026-10-20. Voice moderation is **not implemented**. This document records the server requirements
for the decision in [#49](https://github.com/Duell10111/NexSpeak/issues/49).

## Available control paths

NexSpeak is a static client. Its current MatrixRTC integration exchanges a Matrix OpenID token at
`/sfu/get` for a participant token and selects the SFU of the oldest MatrixRTC membership. That
SFU can belong to another homeserver. A local playback mute only affects the listener; Matrix room
kick/ban changes room membership and is not a call-only disconnect.

The upstream authorization service was inspected at
[`33e5465`](https://github.com/element-hq/lk-jwt-service/blob/33e5465e82ca9c0c4c3e2f22d96112d735d15c80/src/handler.rs).
Its `prepare_router` exposes token exchange, delayed-leave delegation, SFU webhooks, health checks
and application-service integration. There is no Matrix-authorized moderator endpoint. Its
`get_join_token` grants room join, publishing/subscribing and updating the participant's own
metadata; it does not grant `roomAdmin`. Upgrading this service alone therefore does not provide
the missing moderation path.

LiveKit has backend operations, but they do not by themselves implement Matrix moderation:

| Action | LiveKit operation | Remaining requirement |
| --- | --- | --- |
| Mute for everyone | `MutePublishedTrack` or `UpdateParticipant` permissions | A track mute is not a durable restriction on future publications. Define the restricted sources and enforce the policy on subsequent joins and token issuance. |
| Disconnect from call | `RemoveParticipant` | Decide whether rejoining is allowed immediately. A disconnect must not be described as a ban. |
| Move to another channel | `MoveParticipant` on supported deployments | The open-source self-hosted stack cannot rely on this operation. Matrix membership and E2EE key exchange also need a transfer protocol. |

The [Room service API](https://docs.livekit.io/reference/other/roomservice-api/) requires
`roomAdmin` for these moderation operations. Such broad authority should stay in the backend,
where each requested action can be checked against Matrix permissions. LiveKit credentials must
never be bundled into the static app.

LiveKit's [participant management documentation](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/)
marks moving as a Cloud feature; its [Python API reference](https://docs.livekit.io/reference/python/livekit/api/room_service.html)
also mentions Private Cloud. Neither establishes support in the self-hosted open-source stack.
The participant documentation limits automatic token revocation after removal or permission
changes to Cloud. Tests must therefore establish reconnect behavior on the actual supported
server version, including reuse of a token issued before the action. Blocking only new token
requests is insufficient if previously issued tokens still work.

## Proposed enforcement boundary

Prefer extending the authorization service that controls the active SFU, or a companion integrated
with that service's token issuance. A standalone Matrix bot without SFU credentials and token
policy integration cannot enforce these actions. This is an architecture proposal, not a selected
deployment or an API already available to clients.

For every action, the backend must authenticate the moderator, load authoritative source-room
membership and power levels, check an action-specific threshold and the target's role hierarchy,
and resolve every affected device to its actual SFU identity. A request must not accept arbitrary
SFU URLs or treat a client-supplied role as authority. Moving also needs destination membership,
join permission and an explicit decision about private channels.

The existing role/permission editor uses Matrix power-level thresholds (#32/#33). The future
service must define separate mute, disconnect and move permissions that follow that model,
including category/channel overrides. Matrix does not enforce custom voice permissions itself;
adding editor keys without a backend consumer would promise protection the app cannot provide.

A lasting mute needs policy storage and enforcement across reconnection, new devices, new tracks
and token renewal. Removing a server mute should restore permission to publish, leaving microphone
activation to the user. A transfer must preserve the destination's E2EE boundary: copying media
between SFU rooms does not establish Matrix membership or supply destination keys.

Federated calls need the same authorization and enforcement at the active SFU's service. A feature
implemented only on the moderator's own homeserver cannot guarantee control of a remote SFU.
Element Call participants must remain subject to the backend restriction without understanding a
NexSpeak-only event. Capability discovery must hide unavailable actions, with no periodic client
polling or additional media processing.

## Decisions and acceptance tests before implementation

1. In #49, select the service owner, deployment and supported homeservers/SFU versions. Specify
   how its authoritative Matrix state and credentials are obtained and how remote SFUs participate.
2. Define restriction duration, scope across devices, role hierarchy, persistence and reconnect
   policy. Choose a server mechanism that also rejects usable old tokens where the policy requires it.
3. Resolve move semantics for self-hosted deployments and MatrixRTC/E2EE. If only a cooperative
   transfer invitation is possible, change the issue scope explicitly before presenting it as a move.
4. Verify unauthorized and stale-role requests are rejected server-side. Verify a modified target
   client cannot undo a mute by unmuting, republishing, reconnecting or obtaining another token.
5. Exercise disconnect and any transfer with NexSpeak and Element Call, multiple devices,
   federation, private destinations and encrypted calls. Run the existing call E2E suite, including
   E2EE, and confirm that no moderation activity adds work while idle.

Until those prerequisites are resolved, #46 remains open and the participant menu keeps its
existing **User volume** and local **Mute** controls.
