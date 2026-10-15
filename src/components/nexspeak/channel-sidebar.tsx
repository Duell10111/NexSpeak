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
  Settings,
  Signal,
  Video,
  Volume2,
  X,
} from "lucide-react"
import { useCallContext, type RoomCallInfo } from "@/components/nexspeak/call-context"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { describeMatrixError } from "@/lib/matrix/errors"
import type { MatrixRoom } from "@/lib/matrix/types"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { SettingsDialog } from "@/components/nexspeak/settings-dialog"

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
  return (
    <div className="ml-8 mr-2 flex h-8 items-center gap-2 rounded px-2 text-muted-foreground hover:bg-nx-hover hover:text-foreground">
      <div className={cn("rounded-full ring-2", member.isSpeaking ? "ring-nx-online" : "ring-transparent")}>
        <MatrixAvatar mxcUrl={member.avatarMxc} name={member.name} size={24} className="text-[10px]" />
      </div>
      <span className={cn("min-w-0 flex-1 truncate text-sm", member.isSpeaking && "text-foreground")}>{member.name}</span>
      {member.isScreensharing && (
        <span className="rounded bg-nx-dnd px-1 text-[10px] font-bold uppercase tracking-wide text-white">Live</span>
      )}
      {member.isMicMuted && <MicOff className="h-3.5 w-3.5 shrink-0" aria-label="Stummgeschaltet" />}
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
          title={isDirectMessages ? undefined : "Doppelklick, um dem Sprachkanal beizutreten"}
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
                aria-label={`${room.name} beitreten`}
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Sprachkanal beitreten</TooltipContent>
          </Tooltip>
        )}
      </div>

      {voiceMembers.length > 0 && (
        <div className="mt-0.5 mb-1 flex flex-col gap-0.5" aria-label={`Im Sprachkanal ${room.name}`}>
          {voiceMembers.map((member) => (
            <VoiceMemberRow key={member.userId} member={member} />
          ))}
        </div>
      )}
    </div>
  )
}

function InviteItem({ room, onAccepted }: { room: MatrixRoom; onAccepted: (roomId: string) => void }) {
  const { client } = useMatrixClient()
  const [isBusy, setIsBusy] = useState(false)

  const respond = async (accept: boolean) => {
    if (!client) return
    setIsBusy(true)
    try {
      if (accept) {
        await client.joinRoom(room.id)
        onAccepted(room.id)
      } else {
        await client.leave(room.id)
      }
    } catch (error) {
      toast.error(describeMatrixError(error, accept ? "Beitritt fehlgeschlagen." : "Ablehnen fehlgeschlagen."))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="mx-2 flex h-[42px] items-center gap-2 rounded px-2 text-sm hover:bg-nx-hover">
      <MatrixAvatar mxcUrl={room.avatarMxc} name={room.name} size={32} className="text-xs" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground">{room.name}</p>
        {room.inviter && <p className="truncate text-xs text-muted-foreground">von {room.inviter}</p>}
      </div>
      <button
        onClick={() => void respond(true)}
        disabled={isBusy}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-nx-online hover:bg-nx-online hover:text-white disabled:opacity-50"
        aria-label="Einladung annehmen"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        onClick={() => void respond(false)}
        disabled={isBusy}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-nx-dnd hover:bg-nx-dnd hover:text-white disabled:opacity-50"
        aria-label="Einladung ablehnen"
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
}: {
  title: string
  collapsed?: boolean
  onToggle?: () => void
}) {
  return (
    <button
      onClick={onToggle}
      disabled={!onToggle}
      className="flex w-full items-center gap-0.5 px-2 pt-4 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground"
      aria-expanded={onToggle ? !collapsed : undefined}
    >
      {onToggle && <ChevronDown className={cn("h-3 w-3 transition-transform", collapsed && "-rotate-90")} />}
      {title}
    </button>
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
            <span className="truncate">{isReconnecting ? "Verbindet erneut…" : "Sprache verbunden"}</span>
          </p>
          <button
            onClick={() => onOpenRoom(call.roomId)}
            className="block max-w-full truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {client?.getRoom(call.roomId)?.name || "Sprachkanal"}
          </button>
        </div>
        <PanelButton label="Verbindung trennen" onClick={leaveCall}>
          <PhoneOff className="h-5 w-5" />
        </PanelButton>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => void toggleCamera()}
          className={toggleClass(call.isCameraOn)}
          aria-label={call.isCameraOn ? "Kamera ausschalten" : "Kamera einschalten"}
          aria-pressed={call.isCameraOn}
        >
          <Video className="h-4 w-4" />
          Video
        </button>
        <button
          onClick={() => void toggleScreenshare()}
          className={toggleClass(call.isScreensharing)}
          aria-label={call.isScreensharing ? "Bildschirmfreigabe beenden" : "Bildschirm teilen"}
          aria-pressed={call.isScreensharing}
        >
          <MonitorUp className="h-4 w-4" />
          Bildschirm
        </button>
      </div>
    </div>
  )
}

export function ChannelSidebar({
  title,
  sections,
  invites,
  isDirectMessages,
  activeChannelId,
  onChannelSelect,
}: ChannelSidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const { client } = useMatrixClient()
  const profile = useOwnProfile(client)
  const { callInfoByRoom, isMicMuted, isDeafened, toggleMicrophone, toggleDeafen } = useCallContext()

  const isEmpty = sections.every((section) => section.rooms.length === 0) && invites.length === 0

  return (
    <div className="flex h-full w-60 shrink-0 flex-col bg-secondary">
      <div className="flex h-12 shrink-0 items-center px-4 shadow-[0_1px_0_rgba(4,4,5,0.2),0_1.5px_0_rgba(6,6,7,0.05),0_2px_0_rgba(4,4,5,0.05)]">
        <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {invites.length > 0 && (
          <div>
            <SectionHeader title={`Einladungen — ${invites.length}`} />
            <div className="flex flex-col gap-0.5">
              {invites.map((room) => (
                <InviteItem key={room.id} room={room} onAccepted={onChannelSelect} />
              ))}
            </div>
          </div>
        )}

        {sections.map((section) => {
          if (section.rooms.length === 0) return null
          const isCollapsed = collapsed[section.id] ?? false
          // Collapsed categories keep the open channel and running calls visible, like Discord.
          const rooms = isCollapsed
            ? section.rooms.filter((room) => room.id === activeChannelId || callInfoByRoom[room.id])
            : section.rooms

          return (
            <div key={section.id}>
              <SectionHeader
                title={section.title ?? "Kanäle"}
                collapsed={isCollapsed}
                onToggle={() => setCollapsed((current) => ({ ...current, [section.id]: !isCollapsed }))}
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

        {isEmpty && (
          <p className="mt-6 px-4 text-center text-xs text-muted-foreground">
            {isDirectMessages ? "Noch keine Direktnachrichten." : "Dieser Server hat keine Räume, denen du beigetreten bist."}
          </p>
        )}

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
                <span className="group-hover:hidden">Online</span>
                <span className="hidden group-hover:inline">{profile?.userId}</span>
              </p>
            </div>
          </div>
          <PanelButton
            label={isMicMuted ? "Mikrofon aktivieren" : "Mikrofon stummschalten"}
            danger={isMicMuted}
            onClick={() => void toggleMicrophone()}
          >
            {isMicMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </PanelButton>
          <PanelButton label={isDeafened ? "Ton aktivieren" : "Ton stummschalten"} danger={isDeafened} onClick={toggleDeafen}>
            {isDeafened ? <HeadphoneOff className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
          </PanelButton>
          <PanelButton label="Einstellungen" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-5 w-5" />
          </PanelButton>
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
