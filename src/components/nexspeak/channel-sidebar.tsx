"use client"

import { useEffect, useState } from "react"
import { UserEvent, type MatrixClient } from "matrix-js-sdk"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Check,
  ChevronDown,
  Hash,
  HeadphoneOff,
  Headphones,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Plus,
  Search,
  Settings,
  Signal,
  UserPlus,
  Video,
  Volume2,
  X,
} from "lucide-react"
import { useCallContext, type RoomCallInfo } from "@/components/nexspeak/call-context"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@/lib/matrix/errors"
import { inviteToSpace, joinSpaceChannels, rememberDirectRoom } from "@/lib/matrix/direct"
import type { MatrixRoom } from "@/lib/matrix/types"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { SettingsDialog } from "@/components/nexspeak/settings-dialog"
import { UserPickerDialog } from "@/components/nexspeak/user-picker-dialog"
import { useOpenDirectMessage } from "@/components/nexspeak/navigation-context"

export interface RoomSection {
  id: string
  title?: string
  rooms: MatrixRoom[]
}

interface ChannelSidebarProps {
  title: string
  sections: RoomSection[]
  invites: MatrixRoom[]
  isDirectMessages: boolean
  /** The space shown, if any (not on the DM home). */
  serverId?: string
  activeChannelId: string
  onChannelSelect: (id: string) => void
}

interface VoiceMember {
  userId: string
  name: string
  avatarMxc?: string
  isSpeaking: boolean
  isMicMuted: boolean
  isScreensharing: boolean
}

function useOwnProfile(client: MatrixClient | null) {
  const [profile, setProfile] = useState<{ userId: string; name: string; avatarMxc?: string } | null>(null)

  useEffect(() => {
    const userId = client?.getUserId()
    if (!client || !userId) return

    const refresh = () => {
      const user = client.getUser(userId)
      setProfile({ userId, name: user?.displayName || userId, avatarMxc: user?.avatarUrl || undefined })
    }

    queueMicrotask(refresh)
    // The own user object is often only populated after the first sync; fetch it explicitly.
    client
      .getProfileInfo(userId)
      .then((info) => setProfile({ userId, name: info.displayname || userId, avatarMxc: info.avatar_url || undefined }))
      .catch(() => {})

    client.on(UserEvent.DisplayName, refresh)
    client.on(UserEvent.AvatarUrl, refresh)
    return () => {
      client.removeListener(UserEvent.DisplayName, refresh)
      client.removeListener(UserEvent.AvatarUrl, refresh)
    }
  }, [client])

  return profile
}

/** Who to list under a room: live state for our own call, MatrixRTC memberships otherwise. */
function useVoiceMembers(roomId: string, callInfo: RoomCallInfo | undefined): VoiceMember[] {
  const { call } = useCallContext()

  if (call?.roomId === roomId) {
    const byUser = new Map<string, VoiceMember>()
    call.participants.forEach((participant) => {
      const existing = byUser.get(participant.userId)
      // Several devices of one user show up once; any device speaking/sharing counts.
      byUser.set(participant.userId, {
        userId: participant.userId,
        name: participant.name,
        avatarMxc: participant.avatarMxc,
        isSpeaking: (existing?.isSpeaking ?? false) || (participant.isSpeaking && !participant.isMicMuted),
        isMicMuted: (existing?.isMicMuted ?? true) && participant.isMicMuted,
        isScreensharing: (existing?.isScreensharing ?? false) || participant.isScreensharing,
      })
    })
    return Array.from(byUser.values())
  }

  return (callInfo?.members ?? []).map((member) => ({
    ...member,
    isSpeaking: false,
    isMicMuted: false,
    isScreensharing: false,
  }))
}

function VoiceMemberRow({ member }: { member: VoiceMember }) {
  const { t } = useTranslation()
  return (
    <div className="ml-8 mr-2 flex h-8 items-center gap-2 rounded px-2 text-muted-foreground hover:bg-nx-hover hover:text-foreground">
      <div className={cn("rounded-full ring-2", member.isSpeaking ? "ring-nx-online" : "ring-transparent")}>
        <MatrixAvatar mxcUrl={member.avatarMxc} name={member.name} size={24} className="text-[10px]" />
      </div>
      <span className={cn("min-w-0 flex-1 truncate text-sm", member.isSpeaking && "text-foreground")}>{member.name}</span>
      {member.isScreensharing && (
        <span className="rounded bg-nx-dnd px-1 text-[10px] font-bold uppercase tracking-wide text-white">Live</span>
      )}
      {member.isMicMuted && <MicOff className="h-3.5 w-3.5 shrink-0" aria-label={t("call.muted")} />}
    </div>
  )
}

function RoomItem({
  room,
  isActive,
  isDirectMessages,
  callInfo,
  onSelect,
}: {
  room: MatrixRoom
  isActive: boolean
  isDirectMessages: boolean
  callInfo?: RoomCallInfo
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const { call, joinCall, joiningRoomId } = useCallContext()
  const voiceMembers = useVoiceMembers(room.id, callInfo)
  const hasUnread = room.unread > 0 && !isActive
  const isOwnCall = call?.roomId === room.id
  const hasCall = voiceMembers.length > 0
  const mentionCount = isDirectMessages ? room.unread : room.highlights

  return (
    <div>
      <div className="group relative mx-2">
        {hasUnread && <span className="absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground" />}
        <button
          onClick={onSelect}
          onDoubleClick={isDirectMessages ? undefined : () => void joinCall(room.id)}
          className={cn(
            "flex w-full items-center gap-1.5 rounded px-2 text-left transition-colors",
            isDirectMessages ? "h-[42px]" : "h-8",
            isActive
              ? "bg-nx-active text-foreground"
              : hasUnread
                ? "text-foreground hover:bg-nx-hover"
                : "text-muted-foreground hover:bg-nx-hover hover:text-nx-hover-foreground",
          )}
          aria-current={isActive ? "page" : undefined}
          title={isDirectMessages ? undefined : t("channel.doubleClickToJoin")}
        >
          {isDirectMessages ? (
            <MatrixAvatar mxcUrl={room.avatarMxc} name={room.name} size={32} className="mr-1.5 text-xs" />
          ) : hasCall ? (
            <Volume2 className={cn("h-5 w-5 shrink-0", isOwnCall ? "text-nx-online" : "opacity-70")} />
          ) : (
            <Hash className="h-5 w-5 shrink-0 opacity-70" />
          )}
          <span className={cn("min-w-0 flex-1 truncate text-[15px]", (hasUnread || isActive) && "font-medium")}>
            {room.name}
          </span>
          {hasUnread && mentionCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-nx-dnd px-1 text-[11px] font-bold text-white">
              {mentionCount > 99 ? "99+" : mentionCount}
            </span>
          )}
        </button>

        {!isDirectMessages && !isOwnCall && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => void joinCall(room.id)}
                disabled={Boolean(joiningRoomId)}
                className={cn(
                  "absolute top-1/2 right-1 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
                  hasUnread && mentionCount > 0 && "group-hover:bg-nx-hover",
                )}
                aria-label={t("channel.joinNamed", { name: room.name })}
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("call.joinVoice")}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {voiceMembers.length > 0 && (
        <div className="mt-0.5 mb-1 flex flex-col gap-0.5" aria-label={t("channel.inVoiceNamed", { name: room.name })}>
          {voiceMembers.map((member) => (
            <VoiceMemberRow key={member.userId} member={member} />
          ))}
        </div>
      )}
    </div>
  )
}

function InviteItem({ room, onAccepted }: { room: MatrixRoom; onAccepted: (roomId: string) => void }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const [isBusy, setIsBusy] = useState(false)

  const respond = async (accept: boolean) => {
    if (!client) return
    setIsBusy(true)
    try {
      if (!accept) {
        await client.leave(room.id)
        return
      }
      const invitedRoom = client.getRoom(room.id)
      const isSpace = Boolean(invitedRoom?.isSpaceRoom())
      const dmInviter = isSpace ? undefined : invitedRoom?.getDMInviter()
      const joined = await client.joinRoom(room.id)
      if (isSpace) {
        // A server without its channels would look empty.
        await joinSpaceChannels(client, room.id).catch((error: unknown) => console.warn("Joining channels failed:", error))
      } else if (dmInviter) {
        await rememberDirectRoom(client, joined, dmInviter).catch((error: unknown) => console.warn("Updating m.direct failed:", error))
      }
      onAccepted(room.id)
    } catch (error) {
      toast.error(describeMatrixError(error, accept ? t("invite.acceptFailed") : t("invite.declineFailed")))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="mx-2 flex h-[42px] items-center gap-2 rounded px-2 text-sm hover:bg-nx-hover">
      <MatrixAvatar mxcUrl={room.avatarMxc} name={room.name} size={32} className="text-xs" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground">{room.name}</p>
        {room.inviter && <p className="truncate text-xs text-muted-foreground">{t("invite.from", { name: room.inviter })}</p>}
      </div>
      <button
        onClick={() => void respond(true)}
        disabled={isBusy}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-nx-online hover:bg-nx-online hover:text-white disabled:opacity-50"
        aria-label={t("invite.accept")}
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        onClick={() => void respond(false)}
        disabled={isBusy}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-nx-dnd hover:bg-nx-dnd hover:text-white disabled:opacity-50"
        aria-label={t("invite.decline")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function SectionHeader({
  title,
  collapsed,
  onToggle,
  action,
}: {
  title: string
  collapsed?: boolean
  onToggle?: () => void
  /** Small button at the right, e.g. "+" for a new DM. */
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex items-center pr-2">
      <button
        onClick={onToggle}
        disabled={!onToggle}
        className="flex min-w-0 flex-1 items-center gap-0.5 px-2 pt-4 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground"
        aria-expanded={onToggle ? !collapsed : undefined}
      >
        {onToggle && <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", collapsed && "-rotate-90")} />}
        <span className="truncate">{title}</span>
      </button>
      {action && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={action.onClick}
              className="mt-3 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label={action.label}
            >
              <Plus className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{action.label}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function PanelButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string
  /** Shown red: muted/deafened. */
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-nx-hover",
            danger ? "text-nx-dnd" : "text-muted-foreground hover:text-foreground",
          )}
          aria-label={label}
          aria-pressed={danger}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Discord's "Voice Connected" panel above the user panel. */
function VoiceConnectionPanel({ onOpenRoom }: { onOpenRoom: (roomId: string) => void }) {
  const { t } = useTranslation()
  const { call, leaveCall, toggleCamera, toggleScreenshare } = useCallContext()
  const { client } = useMatrixClient()
  if (!call) return null

  const isReconnecting = call.connectionState === "reconnecting"
  const toggleClass = (active: boolean) =>
    cn(
      "flex h-8 flex-1 items-center justify-center gap-1.5 rounded text-sm font-medium transition-colors",
      active ? "bg-foreground text-background hover:bg-foreground/90" : "bg-secondary text-foreground hover:bg-nx-hover",
    )

  return (
    <div className="border-b border-border/50 px-2 pt-2 pb-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 pl-1">
          <p className={cn("flex items-center gap-1 text-sm font-semibold", isReconnecting ? "text-nx-idle" : "text-nx-online")}>
            <Signal className="h-4 w-4 shrink-0" />
            <span className="truncate">{isReconnecting ? t("call.reconnecting") : t("call.voiceConnected")}</span>
          </p>
          <button
            onClick={() => onOpenRoom(call.roomId)}
            className="block max-w-full truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {client?.getRoom(call.roomId)?.name || t("call.voiceChannel")}
          </button>
        </div>
        <PanelButton label={t("call.disconnect")} onClick={leaveCall}>
          <PhoneOff className="h-5 w-5" />
        </PanelButton>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => void toggleCamera()}
          className={toggleClass(call.isCameraOn)}
          aria-label={call.isCameraOn ? t("call.cameraOff") : t("call.cameraOn")}
          aria-pressed={call.isCameraOn}
        >
          <Video className="h-4 w-4" />
          {t("call.video")}
        </button>
        <button
          onClick={() => void toggleScreenshare()}
          className={toggleClass(call.isScreensharing)}
          aria-label={call.isScreensharing ? t("call.stopScreenshare") : t("call.shareScreen")}
          aria-pressed={call.isScreensharing}
        >
          <MonitorUp className="h-4 w-4" />
          {t("call.screen")}
        </button>
      </div>
    </div>
  )
}

/** Discord's "Invite people" for a server: invites to the space and, where needed, its channels. */
function ServerInviteDialog({
  serverId,
  channelIds,
  open,
  onOpenChange,
}: {
  serverId: string
  channelIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const space = client?.getRoom(serverId)
  const memberIds = space?.getJoinedMembers().map((member) => member.userId) ?? []

  const invite = async (users: Array<{ userId: string; displayName: string }>) => {
    if (!client) return
    const failed: Array<{ name: string; error: unknown }> = []
    for (const user of users) {
      try {
        await inviteToSpace(client, serverId, channelIds, user.userId)
      } catch (error) {
        failed.push({ name: user.displayName, error })
      }
    }
    const invitedCount = users.length - failed.length
    if (invitedCount > 0) {
      toast.success(
        invitedCount === 1 && failed.length === 0
          ? t("server.invitedOne", { name: users[0].displayName })
          : t("server.invitedMany", { count: invitedCount }),
      )
    }
    failed.forEach(({ name, error }) =>
      toast.error(t("server.inviteFailedFor", { name, reason: describeMatrixError(error) })),
    )
    if (failed.length === 0) onOpenChange(false)
  }

  return (
    <UserPickerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("server.inviteTitle", { name: space?.name || t("nav.server") })}
      description={t("server.inviteDescription")}
      submitLabel={t("server.inviteSubmit")}
      excludeUserIds={memberIds}
      onSubmit={invite}
    />
  )
}

/** A joined server whose channels we're not in yet (e.g. accepted in another client). */
function JoinChannelsHint({ serverId }: { serverId: string }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const [isJoining, setIsJoining] = useState(false)

  const join = async () => {
    if (!client) return
    setIsJoining(true)
    try {
      const count = await joinSpaceChannels(client, serverId)
      // Joined channels show up through the room list on their own.
      if (count === 0) toast.info(t("server.noJoinableChannels"))
    } catch (error) {
      toast.error(describeMatrixError(error, t("server.joinChannelsFailed")))
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <div className="mt-6 space-y-3 px-4 text-center text-xs text-muted-foreground">
      <p>{t("server.noJoinedChannels")}</p>
      <button
        onClick={() => void join()}
        disabled={isJoining}
        className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {t("server.joinChannels")}
      </button>
    </div>
  )
}

export function ChannelSidebar({
  title,
  sections,
  invites,
  isDirectMessages,
  serverId,
  activeChannelId,
  onChannelSelect,
}: ChannelSidebarProps) {
  const { t } = useTranslation()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newDmOpen, setNewDmOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const { client } = useMatrixClient()
  const profile = useOwnProfile(client)
  const openDirectMessage = useOpenDirectMessage()
  const { callInfoByRoom, isMicMuted, isDeafened, toggleMicrophone, toggleDeafen } = useCallContext()

  const isEmpty = sections.every((section) => section.rooms.length === 0) && invites.length === 0
  const canInvite = Boolean(serverId && client?.getRoom(serverId)?.canInvite(client.getUserId() ?? ""))
  const channelIds = sections.flatMap((section) => section.rooms.map((room) => room.id))
  const newDmAction = { label: t("dm.new"), onClick: () => setNewDmOpen(true) }

  return (
    <div className="flex h-full w-60 shrink-0 flex-col bg-secondary">
      <div className="flex h-12 shrink-0 items-center gap-1 px-4 shadow-[0_1px_0_rgba(4,4,5,0.2),0_1.5px_0_rgba(6,6,7,0.05),0_2px_0_rgba(4,4,5,0.05)]">
        {isDirectMessages ? (
          // Discord's "Find or start a conversation" box.
          <button
            onClick={() => setNewDmOpen(true)}
            className="-mx-2 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded bg-nx-guild-bar px-2 text-left text-sm text-muted-foreground hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("dm.findOrStart")}</span>
          </button>
        ) : (
          <>
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{title}</h2>
            {canInvite && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setInviteOpen(true)}
                    className="-mr-1 rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label={t("server.invite")}
                  >
                    <UserPlus className="h-[18px] w-[18px]" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("server.invite")}</TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {invites.length > 0 && (
          <div>
            <SectionHeader title={t("invite.section", { count: invites.length })} />
            <div className="flex flex-col gap-0.5">
              {invites.map((room) => (
                <InviteItem key={room.id} room={room} onAccepted={onChannelSelect} />
              ))}
            </div>
          </div>
        )}

        {sections.map((section) => {
          // The DM list stays visible with its "+" even while empty.
          const isDmSection = isDirectMessages && section.id === "direct"
          if (section.rooms.length === 0 && !isDmSection) return null
          const isCollapsed = collapsed[section.id] ?? false
          // Collapsed categories keep the open channel and running calls visible, like Discord.
          const rooms = isCollapsed
            ? section.rooms.filter((room) => room.id === activeChannelId || callInfoByRoom[room.id])
            : section.rooms

          return (
            <div key={section.id}>
              <SectionHeader
                title={section.title ?? t("channel.channels")}
                collapsed={isCollapsed}
                onToggle={() => setCollapsed((current) => ({ ...current, [section.id]: !isCollapsed }))}
                action={isDmSection ? newDmAction : undefined}
              />
              <div className="flex flex-col gap-0.5">
                {rooms.map((room) => (
                  <RoomItem
                    key={room.id}
                    room={room}
                    isActive={activeChannelId === room.id}
                    isDirectMessages={isDirectMessages}
                    callInfo={callInfoByRoom[room.id]}
                    onSelect={() => onChannelSelect(room.id)}
                  />
                ))}
              </div>
            </div>
          )
        })}

        {isEmpty &&
          (isDirectMessages ? (
            <div className="mt-4 space-y-3 px-4 text-center text-xs text-muted-foreground">
              <p>{t("dm.empty")}</p>
              <button
                onClick={() => setNewDmOpen(true)}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t("dm.new")}
              </button>
            </div>
          ) : serverId ? (
            <JoinChannelsHint key={serverId} serverId={serverId} />
          ) : null)}

        <div className="h-4" />
      </ScrollArea>

      <div className="bg-nx-panel">
        <VoiceConnectionPanel onOpenRoom={onChannelSelect} />

        {/* User panel */}
        <div className="flex h-[52px] items-center gap-1 px-2">
          <div className="group flex min-w-0 flex-1 items-center gap-2 rounded py-1 pr-1 pl-0.5">
            <div className="relative shrink-0">
              <MatrixAvatar mxcUrl={profile?.avatarMxc} name={profile?.name || "?"} size={32} />
              <span className="absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-nx-panel bg-nx-online" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm leading-tight font-semibold text-foreground">{profile?.name || "…"}</p>
              <p className="truncate text-xs leading-tight text-muted-foreground">
                <span className="group-hover:hidden">{t("presence.online")}</span>
                <span className="hidden group-hover:inline">{profile?.userId}</span>
              </p>
            </div>
          </div>
          <PanelButton
            label={isMicMuted ? t("call.unmuteMic") : t("call.muteMic")}
            danger={isMicMuted}
            onClick={() => void toggleMicrophone()}
          >
            {isMicMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </PanelButton>
          <PanelButton label={isDeafened ? t("call.undeafen") : t("call.deafen")} danger={isDeafened} onClick={toggleDeafen}>
            {isDeafened ? <HeadphoneOff className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
          </PanelButton>
          <PanelButton label={t("settings.title")} onClick={() => setSettingsOpen(true)}>
            <Settings className="h-5 w-5" />
          </PanelButton>
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <UserPickerDialog
        open={newDmOpen}
        onOpenChange={setNewDmOpen}
        title={t("dm.newTitle")}
        description={t("dm.newDescription")}
        submitLabel={t("dm.start")}
        onSubmit={async (users) => {
          if (await openDirectMessage(users.map((user) => user.userId))) setNewDmOpen(false)
        }}
      />
      {serverId && (
        <ServerInviteDialog serverId={serverId} channelIds={channelIds} open={inviteOpen} onOpenChange={setInviteOpen} />
      )}
    </div>
  )
}
