"use client"

import { useState } from "react"
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
  Pencil,
  PhoneOff,
  Plus,
  Search,
  Settings,
  Signal,
  SignalHigh,
  SignalLow,
  SignalZero,
  Video,
  Volume2,
  X,
} from "lucide-react"
import { useCallContext, type RoomCallInfo } from "@/components/nexspeak/call-context"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useOwnPresence, useOwnProfile } from "@/hooks/useOwnProfile"
import { useTranslation } from "@/hooks/useTranslation"
import { usePolledStats } from "@/hooks/usePolledStats"
import { PING_HISTORY_LENGTH } from "@nexspeak/core/connection-stats"
import type { CallConnectionQuality } from "@nexspeak/core/matrix/call-session"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { joinSpaceChannels, rememberDirectRoom } from "@nexspeak/core/matrix/direct"
import type { MatrixRoom } from "@nexspeak/core/matrix/types"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { SettingsDialog, type SettingsTab } from "@/components/nexspeak/settings-dialog"
import { PRESENCE_DOT, PRESENCE_LABEL, PresencePicker } from "@/components/nexspeak/profile-panel"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { UserPickerDialog } from "@/components/nexspeak/user-picker-dialog"
import { useOpenDirectMessage } from "@/components/nexspeak/navigation-context"
import {
  CategoryContextMenu,
  ChannelContextMenu,
  ServerHeaderMenu,
  ServerManagementProvider,
  useServerManagement,
} from "@/components/nexspeak/server-management"

export interface RoomSection {
  id: string
  title?: string
  /** A server category (Matrix sub-space); the others are the server's own channels or DM lists. */
  isCategory?: boolean
  rooms: MatrixRoom[]
}

interface ChannelSidebarProps {
  title: string
  sections: RoomSection[]
  invites: MatrixRoom[]
  isDirectMessages: boolean
  /** The space shown, if any (not on the DM home). */
  serverId?: string
  /** Changes when the server's channels change; new ones are joined in the background. */
  structureKey?: string
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
  const management = useServerManagement()
  const canEdit = !isDirectMessages && Boolean(management?.canEdit(room.id))
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
          ) : room.iconMxc ? (
            <MatrixAvatar mxcUrl={room.iconMxc} name={room.name} size={20} className="rounded-md text-[10px]" />
          ) : (
            <Hash className="h-5 w-5 shrink-0 opacity-70" />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[15px]",
              (hasUnread || isActive) && "font-medium",
              // Room for the hover buttons.
              !isDirectMessages && (canEdit ? "group-hover:pr-12" : "group-hover:pr-6"),
            )}
          >
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

        {canEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => management?.editRoom(room.id)}
                className={cn(
                  "absolute top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
                  isOwnCall ? "right-1" : "right-7",
                )}
                aria-label={t("manage.editChannelNamed", { name: room.name })}
              >
                <Settings className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("manage.editChannel")}</TooltipContent>
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
  dragProps,
}: {
  title: string
  collapsed?: boolean
  onToggle?: () => void
  /** Small button at the right, e.g. "+" for a new DM or channel. */
  action?: { label: string; onClick: () => void }
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean }
}) {
  return (
    <div className="group/section flex items-center pr-2" {...dragProps}>
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

const QUALITY_ICON: Record<CallConnectionQuality, typeof Signal> = {
  excellent: Signal,
  good: SignalHigh,
  poor: SignalLow,
  lost: SignalZero,
  unknown: Signal,
}

const QUALITY_COLOR: Record<CallConnectionQuality, string> = {
  excellent: "text-nx-online",
  good: "text-nx-online",
  poor: "text-nx-idle",
  lost: "text-nx-dnd",
  unknown: "text-nx-online",
}

/** Ping of the last minute as a line, scaled to at least 100 ms so low pings stay flat. */
function PingGraph({ pings, label }: { pings: number[]; label: string }) {
  if (pings.length < 2) return null
  const max = Math.max(100, ...pings)
  const offset = PING_HISTORY_LENGTH - pings.length
  const points = pings.map((ping, index) => `${offset + index},${(24 - (ping / max) * 22).toFixed(1)}`).join(" ")
  return (
    <svg
      viewBox={`0 0 ${PING_HISTORY_LENGTH - 1} 24`}
      preserveAspectRatio="none"
      className="h-10 w-full rounded bg-secondary text-nx-online"
      role="img"
      aria-label={label}
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Discord's connection info: polls WebRTC stats only while the popover is open (mounted). */
function ConnectionDetails() {
  const { t, intl } = useTranslation()
  const { call, createConnectionSampler } = useCallContext()
  const info = usePolledStats(createConnectionSampler)
  const ms = (value: number | null | undefined) => (value == null ? "–" : `${Math.round(value)} ms`)
  const percent = (value: number | null | undefined) =>
    value == null ? "–" : value.toLocaleString(intl, { style: "percent", maximumFractionDigits: 1 })
  const transport = info?.protocol
    ? `${info.protocol.toUpperCase()}${info.relayed ? ` ${t("call.relayed")}` : ""}`
    : "–"
  const rows: Array<[string, string]> = [
    [t("call.averagePing"), ms(info?.averagePingMs)],
    [t("call.ping"), ms(info?.pingMs)],
    [t("call.outboundLoss"), percent(info?.outboundLoss)],
    [t("call.inboundLoss"), percent(info?.inboundLoss)],
    [t("call.transport"), transport],
    [t("call.server"), info?.server || "–"],
    [t("call.encryption"), call?.isEncrypted ? t("call.e2ee") : t("call.transportOnly")],
  ]
  return (
    <div className="space-y-2" data-testid="connection-details">
      <PingGraph pings={info?.pingHistory ?? []} label={t("call.pingGraph")} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate text-right font-medium tabular-nums" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Discord's "Voice Connected" panel above the user panel. */
function VoiceConnectionPanel({ onOpenRoom }: { onOpenRoom: (roomId: string) => void }) {
  const { t } = useTranslation()
  const { call, leaveCall, toggleCamera, toggleScreenshare } = useCallContext()
  const { client } = useMatrixClient()
  if (!call) return null

  const isReconnecting = call.connectionState === "reconnecting"
  const quality = call.connectionQuality
  const QualityIcon = isReconnecting ? SignalZero : QUALITY_ICON[quality]
  const toggleClass = (active: boolean) =>
    cn(
      "flex h-8 flex-1 items-center justify-center gap-1.5 rounded text-sm font-medium transition-colors",
      active ? "bg-foreground text-background hover:bg-foreground/90" : "bg-secondary text-foreground hover:bg-nx-hover",
    )

  return (
    <div className="border-b border-border/50 px-2 pt-2 pb-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 pl-1">
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "flex max-w-full items-center gap-1 text-sm font-semibold hover:underline",
                  isReconnecting ? "text-nx-idle" : QUALITY_COLOR[quality],
                )}
                aria-label={t("call.connectionDetails")}
                data-quality={quality}
              >
                <QualityIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">{isReconnecting ? t("call.reconnecting") : t("call.voiceConnected")}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-72 space-y-2 p-3">
              <p className={cn("text-sm font-semibold", isReconnecting ? "text-nx-idle" : QUALITY_COLOR[quality])}>
                {isReconnecting ? t("call.reconnecting") : t(`call.quality.${quality}`)}
              </p>
              <ConnectionDetails />
            </PopoverContent>
          </Popover>
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

type DragItem = { kind: "channel" | "category"; id: string }
type DropTarget = { sectionId: string; beforeId: string | null }

function DropLine() {
  return <div className="mx-2 h-0.5 rounded bg-primary" aria-hidden />
}

/**
 * The sections with their channels. On servers, people who may manage channels can drag
 * channels between positions and categories, and drag categories (native drag and drop, no
 * library; menus offer the same for touch and keyboard).
 */
function ChannelList({
  sections,
  isDirectMessages,
  activeChannelId,
  onChannelSelect,
  onNewDm,
}: {
  sections: RoomSection[]
  isDirectMessages: boolean
  activeChannelId: string
  onChannelSelect: (id: string) => void
  onNewDm: () => void
}) {
  const { t } = useTranslation()
  const management = useServerManagement()
  const { callInfoByRoom } = useCallContext()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const canManage = !isDirectMessages && Boolean(management?.canManage)
  const hasCategories = sections.some((section) => section.isCategory)
  const categories = sections.filter((section) => section.isCategory)
  const managedSections = sections.map((section) => ({ ...section, name: section.title, isCategory: Boolean(section.isCategory) }))

  const updateDrop = (next: DropTarget) => {
    if (drop?.sectionId !== next.sectionId || drop.beforeId !== next.beforeId) setDrop(next)
  }

  const endDrag = () => {
    setDrag(null)
    setDrop(null)
  }

  const commitDrop = () => {
    if (drag && drop && management) {
      if (drag.kind === "channel") {
        const section = sections.find((entry) => entry.id === drop.sectionId)
        const index = section?.rooms.findIndex((room) => room.id === drag.id) ?? -1
        const nextId = index === -1 ? undefined : (section?.rooms[index + 1]?.id ?? null)
        // Dropping right where it already is changes nothing.
        if (drop.beforeId !== drag.id && !(index !== -1 && drop.beforeId === nextId)) {
          management.moveChannel(drag.id, drop.sectionId, drop.beforeId)
        }
      } else if (drop.beforeId !== drag.id) {
        const index = categories.findIndex((category) => category.id === drag.id)
        if (drop.beforeId !== (categories[index + 1]?.id ?? null)) management.moveCategory(drag.id, drop.beforeId)
      }
    }
    endDrag()
  }

  const dragStart = (item: DragItem) => (event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", item.id)
    setDrag(item)
  }

  const isLowerHalf = (event: React.DragEvent) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY > rect.top + rect.height / 2
  }

  return (
    <>
      {sections.map((section) => {
        // The DM list stays visible with its "+" even while empty, categories as drop targets.
        const isDmSection = isDirectMessages && section.id === "direct"
        const keepEmpty = isDmSection || section.isCategory || (canManage && hasCategories)
        if (section.rooms.length === 0 && !keepEmpty) return null
        const isCollapsed = collapsed[section.id] ?? false
        // Collapsed categories keep the open channel and running calls visible, like Discord.
        const rooms = isCollapsed
          ? section.rooms.filter((room) => room.id === activeChannelId || callInfoByRoom[room.id])
          : section.rooms
        const categoryIndex = categories.findIndex((category) => category.id === section.id)

        const headerDragProps: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean } = canManage
          ? {
              draggable: Boolean(section.isCategory),
              onDragStart: section.isCategory ? dragStart({ kind: "category", id: section.id }) : undefined,
              onDragEnd: endDrag,
              onDragOver: (event) => {
                if (drag?.kind === "channel") {
                  event.preventDefault()
                  updateDrop({ sectionId: section.id, beforeId: section.rooms[0]?.id ?? null })
                } else if (drag?.kind === "category" && section.isCategory) {
                  event.preventDefault()
                  updateDrop({
                    sectionId: "categories",
                    beforeId: isLowerHalf(event) ? (categories[categoryIndex + 1]?.id ?? null) : section.id,
                  })
                }
              },
              onDrop: (event) => {
                event.preventDefault()
                commitDrop()
              },
            }
          : {}

        const header = (
          <SectionHeader
            title={section.title ?? t("channel.channels")}
            collapsed={isCollapsed}
            onToggle={() => setCollapsed((current) => ({ ...current, [section.id]: !isCollapsed }))}
            action={
              isDmSection
                ? { label: t("dm.new"), onClick: onNewDm }
                : canManage
                  ? { label: t("manage.createChannelIn", { name: section.title ?? t("channel.channels") }), onClick: () => management?.createChannel(section.id) }
                  : undefined
            }
            dragProps={headerDragProps}
          />
        )

        return (
          <div key={section.id}>
            {drag?.kind === "category" && drop?.sectionId === "categories" && drop.beforeId === section.id && <DropLine />}
            {section.isCategory ? <CategoryContextMenu categoryId={section.id}>{header}</CategoryContextMenu> : header}
            <div className="flex flex-col gap-0.5">
              {rooms.map((room, index) => {
                const item = (
                  <RoomItem
                    room={room}
                    isActive={activeChannelId === room.id}
                    isDirectMessages={isDirectMessages}
                    callInfo={callInfoByRoom[room.id]}
                    onSelect={() => onChannelSelect(room.id)}
                  />
                )
                if (isDirectMessages || !management) {
                  return (
                    <ChannelContextMenu key={room.id} room={room} sections={[]}>
                      {item}
                    </ChannelContextMenu>
                  )
                }
                return (
                  <div
                    key={room.id}
                    draggable={canManage}
                    onDragStart={canManage ? dragStart({ kind: "channel", id: room.id }) : undefined}
                    onDragEnd={endDrag}
                    onDragOver={(event) => {
                      if (drag?.kind !== "channel") return
                      event.preventDefault()
                      updateDrop({
                        sectionId: section.id,
                        beforeId: isLowerHalf(event) ? (rooms[index + 1]?.id ?? null) : room.id,
                      })
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      commitDrop()
                    }}
                    className={cn(drag?.id === room.id && "opacity-50")}
                  >
                    {drag?.kind === "channel" && drop?.sectionId === section.id && drop.beforeId === room.id && <DropLine />}
                    <ChannelContextMenu room={room} sections={managedSections}>
                      {item}
                    </ChannelContextMenu>
                  </div>
                )
              })}
              {drag?.kind === "channel" && drop?.sectionId === section.id && drop.beforeId === null && <DropLine />}
            </div>
            {section.isCategory &&
              categoryIndex === categories.length - 1 &&
              drag?.kind === "category" &&
              drop?.sectionId === "categories" &&
              drop.beforeId === null && <DropLine />}
          </div>
        )
      })}
    </>
  )
}

export function ChannelSidebar({
  title,
  sections,
  invites,
  isDirectMessages,
  serverId,
  structureKey = "",
  activeChannelId,
  onChannelSelect,
}: ChannelSidebarProps) {
  const { t } = useTranslation()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("audio")
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const ownPresence = useOwnPresence()
  const [newDmOpen, setNewDmOpen] = useState(false)
  const { client } = useMatrixClient()
  const profile = useOwnProfile(client)
  const openDirectMessage = useOpenDirectMessage()
  const { isMicMuted, isDeafened, toggleMicrophone, toggleDeafen } = useCallContext()

  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }

  const isEmpty = sections.every((section) => section.rooms.length === 0 && !section.isCategory) && invites.length === 0

  const content = (
    <>
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
        ) : serverId ? (
          <ServerHeaderMenu title={title} />
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{title}</h2>
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

        <ChannelList
          sections={sections}
          isDirectMessages={isDirectMessages}
          activeChannelId={activeChannelId}
          onChannelSelect={onChannelSelect}
          onNewDm={() => setNewDmOpen(true)}
        />

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
          <Popover open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
            <PopoverTrigger asChild>
              <button
                className="group flex min-w-0 flex-1 items-center gap-2 rounded py-1 pr-1 pl-0.5 text-left hover:bg-nx-hover"
                aria-label={t("profile.menu")}
              >
                <div className="relative shrink-0">
                  <MatrixAvatar mxcUrl={profile?.avatarMxc} name={profile?.name || "?"} size={32} />
                  <span
                    className={cn(
                      "absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-nx-panel",
                      PRESENCE_DOT[ownPresence],
                    )}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm leading-tight font-semibold text-foreground">{profile?.name || "…"}</p>
                  <p className="truncate text-xs leading-tight text-muted-foreground">
                    <span className="group-hover:hidden">{t(PRESENCE_LABEL[ownPresence])}</span>
                    <span className="hidden group-hover:inline">{profile?.userId}</span>
                  </p>
                </div>
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-64 p-1.5">
              <PresencePicker onPicked={() => setProfileMenuOpen(false)} />
              <div className="my-1 h-px bg-border" />
              <button
                onClick={() => {
                  setProfileMenuOpen(false)
                  openSettings("profile")
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
              >
                <Pencil className="h-4 w-4 text-muted-foreground" />
                {t("profile.edit")}
              </button>
            </PopoverContent>
          </Popover>
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
          <PanelButton label={t("settings.title")} onClick={() => openSettings("audio")}>
            <Settings className="h-5 w-5" />
          </PanelButton>
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} initialTab={settingsTab} />
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
    </>
  )

  return (
    <div className="flex h-full w-60 shrink-0 flex-col bg-secondary">
      {serverId ? (
        <ServerManagementProvider
          serverId={serverId}
          sections={sections.map((section) => ({ ...section, name: section.title, isCategory: Boolean(section.isCategory) }))}
          structureKey={structureKey}
        >
          {content}
        </ServerManagementProvider>
      ) : (
        content
      )}
    </div>
  )
}
