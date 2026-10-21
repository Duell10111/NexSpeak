"use client"

import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Plus, Volume2 } from "lucide-react"
import { useCallContext } from "@/components/nexspeak/call-context"
import { JoinRoomDialog } from "@/components/nexspeak/join-room-dialog"
import { CreateServerDialog } from "@/components/nexspeak/create-server-dialog"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useMediaUrl } from "@/hooks/useMediaUrl"
import { useTranslation } from "@/hooks/useTranslation"
import { DIRECT_MESSAGES_ID, type MatrixRoom, type MatrixSpace } from "@nexspeak/core/matrix/types"

interface ServerSidebarProps {
  spaces: MatrixSpace[]
  roomsBySpace: Record<string, MatrixRoom[]>
  activeServerId: string
  homeUnread: number
  onServerSelect: (id: string) => void
  onRoomJoined: (roomId: string) => void
  onServerCreated: (serverId: string, channelId: string) => void
}

const SPACE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"]

function getSpaceColor(spaceId: string): string {
  let hash = 0
  for (let i = 0; i < spaceId.length; i += 1) {
    hash = (hash << 5) - hash + spaceId.charCodeAt(i)
    hash |= 0
  }
  return SPACE_COLORS[Math.abs(hash) % SPACE_COLORS.length]
}

function UnreadBadge({ mentions, unread, isActive }: { mentions: number; unread: number; isActive: boolean }) {
  if (mentions > 0) {
    return (
      <span className="absolute -bottom-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-[3px] border-nx-guild-bar bg-destructive px-1 text-[11px] font-bold text-destructive-foreground">
        {mentions > 99 ? "99+" : mentions}
      </span>
    )
  }
  if (unread > 0 && !isActive) {
    return <span className="absolute -left-3 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground" />
  }
  return null
}

/** Discord marks the server you are talking in with a small speaker. */
/**
 * The app's mark (apps/desktop/scripts/render-icons.mjs) without its tile: in the brand colours
 * on the guild bar, white on the accent when the button is active or hovered.
 */
function AppMark({ active }: { active: boolean }) {
  const accent = active ? "text-current" : "text-primary group-hover:text-current"
  return (
    <svg viewBox="200 200 624 660" className="h-7 w-7" aria-hidden>
      <g
        className={accent}
        fill="none"
        stroke="currentColor"
        strokeWidth="84"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M400 250H250V810L370 710H400" />
        <path d="M624 250H774V710H624" />
      </g>
      <g fill="currentColor">
        <circle cx="512" cy="372" r="54" className={accent} />
        <circle cx="404" cy="480" r="54" />
        <circle cx="620" cy="480" r="54" />
        <circle cx="512" cy="588" r="54" />
      </g>
    </svg>
  )
}

function VoiceBadge() {
  const { t } = useTranslation()
  return (
    <span
      className="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full border-[3px] border-nx-guild-bar bg-nx-online text-white"
      aria-label={t("call.activeVoiceChannel")}
    >
      <Volume2 className="h-2.5 w-2.5" />
    </span>
  )
}

function ServerIcon({
  server,
  isActive,
  hasVoice,
  onClick,
}: {
  server: MatrixSpace
  isActive: boolean
  hasVoice: boolean
  onClick: () => void
}) {
  const { client } = useMatrixClient()
  const avatarSrc = useMediaUrl(client, server.avatarMxc, 96)
  const spaceColor = getSpaceColor(server.id)
  const label = server.name

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="group relative flex items-center justify-center">
          {/* Active / hover pill indicator */}
          <div
            className={cn(
              "absolute left-0 w-1 rounded-r-full bg-foreground transition-all duration-200",
              isActive ? "h-10" : "h-0 group-hover:h-5",
            )}
          />
          <button
            onClick={onClick}
            className={cn(
              "relative mx-3 flex h-12 w-12 items-center justify-center text-sm font-semibold transition-all duration-200",
              isActive ? "rounded-[16px]" : "rounded-[24px] hover:rounded-[16px]",
            )}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
          >
            <div
              className={cn(
                "flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit] transition-colors",
                isActive ? "text-primary-foreground" : "bg-nx-guild-bar text-foreground group-hover:text-primary-foreground",
              )}
              style={{ backgroundColor: isActive ? spaceColor : undefined }}
              onMouseEnter={(event) => {
                event.currentTarget.style.backgroundColor = spaceColor
              }}
              onMouseLeave={(event) => {
                if (!isActive) event.currentTarget.style.backgroundColor = ""
              }}
            >
              {avatarSrc ? (
                // eslint-disable-next-line @next/next/no-img-element -- blob: URLs cannot go through next/image
                <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
              ) : (
                label.charAt(0).toUpperCase()
              )}
            </div>
            {hasVoice && server.mentions === 0 ? (
              <VoiceBadge />
            ) : (
              <UnreadBadge mentions={server.mentions} unread={server.unread} isActive={isActive} />
            )}
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="font-semibold">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function ServerSidebar({
  spaces,
  roomsBySpace,
  activeServerId,
  homeUnread,
  onServerSelect,
  onRoomJoined,
  onServerCreated,
}: ServerSidebarProps) {
  const { t } = useTranslation()
  const [joinOpen, setJoinOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const [addTooltipOpen, setAddTooltipOpen] = useState(false)
  const { call } = useCallContext()
  const isHomeActive = activeServerId === DIRECT_MESSAGES_ID
  const callServerId = call
    ? (spaces.find((space) => roomsBySpace[space.id]?.some((room) => room.id === call.roomId))?.id ?? DIRECT_MESSAGES_ID)
    : null

  return (
    <nav
      className="flex h-full w-[72px] shrink-0 flex-col items-center overflow-y-auto bg-nx-guild-bar py-3"
      aria-label={t("nav.serverList")}
    >
      {/* Home / DM button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => onServerSelect(DIRECT_MESSAGES_ID)}
            className={cn(
              "group relative mx-3 mb-2 flex h-12 w-12 items-center justify-center rounded-[16px] text-lg font-bold transition-all hover:rounded-[12px]",
              isHomeActive
                ? "bg-primary text-primary-foreground"
                : "bg-nx-guild-bar text-foreground hover:bg-primary hover:text-primary-foreground",
            )}
            aria-label={t("dm.title")}
            aria-current={isHomeActive ? "page" : undefined}
          >
            <AppMark active={isHomeActive} />
            {callServerId === DIRECT_MESSAGES_ID && homeUnread === 0 ? (
              <VoiceBadge />
            ) : (
              <UnreadBadge mentions={homeUnread} unread={0} isActive={isHomeActive} />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-semibold">
          {t("dm.title")}
        </TooltipContent>
      </Tooltip>

      <div className="mx-auto w-8">
        <Separator className="bg-border" />
      </div>

      <div className="mt-2 flex flex-col items-center gap-2">
        {spaces.map((server) => (
          <ServerIcon
            key={server.id}
            server={server}
            isActive={activeServerId === server.id}
            hasVoice={callServerId === server.id}
            onClick={() => onServerSelect(server.id)}
          />
        ))}
      </div>

      {spaces.length > 0 && (
        <div className="mx-auto mt-2 w-8">
          <Separator className="bg-border" />
        </div>
      )}

      <DropdownMenu open={addMenuOpen} onOpenChange={setAddMenuOpen}>
        {/* The tooltip would otherwise stay on top of the open menu. */}
        <Tooltip open={addTooltipOpen && !addMenuOpen} onOpenChange={setAddTooltipOpen}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                ref={addButtonRef}
                className="mx-3 mt-2 flex h-12 w-12 items-center justify-center rounded-[24px] bg-nx-guild-bar text-nx-online transition-all hover:rounded-[16px] hover:bg-nx-online hover:text-primary-foreground"
                aria-label={t("createServer.add")}
              >
                <Plus className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-semibold">
            {t("createServer.add")}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="end" onPointerDownOutside={(event) => {
          // The closing menu still observes outside clicks during its exit animation. Its trigger
          // already toggles the state; dismissing too would immediately close a reopened menu.
          const target = event.detail.originalEvent.target
          if (target instanceof Node && addButtonRef.current?.contains(target)) event.preventDefault()
        }}>
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>{t("createServer.title")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setJoinOpen(true)}>{t("join.server")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <JoinRoomDialog open={joinOpen} onOpenChange={setJoinOpen} onJoined={onRoomJoined} />
      {createOpen && <CreateServerDialog onOpenChange={setCreateOpen} onCreated={onServerCreated} />}
    </nav>
  )
}
