"use client"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Spinner } from "@/components/ui/spinner"
import { AtSign, Hash, Lock, Menu, Users, Volume2 } from "lucide-react"
import { useCallContext } from "@/components/nexspeak/call-context"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useRoomInfo } from "@/hooks/useRoomInfo"
import { useTranslation } from "@/hooks/useTranslation"
import { CallArea } from "@/components/nexspeak/call-area"
import { MemberList } from "@/components/nexspeak/member-list"
import { RoomChat } from "@/components/nexspeak/room-chat"

interface ChatAreaProps {
  activeChannelId: string
  showMembers: boolean
  onToggleMembers: () => void
  /** Mobile only: open the server/channel navigation. */
  onOpenNavigation: () => void
}

export function HeaderButton({
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "flex h-6 w-6 items-center justify-center transition-colors disabled:opacity-50",
            active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          aria-label={label}
          aria-pressed={active}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function ChatArea({ activeChannelId, showMembers, onToggleMembers, onOpenNavigation }: ChatAreaProps) {
  const { t } = useTranslation()
  const { isInCallInActiveChannel, joinCall, joiningRoomId } = useCallContext()
  const { client } = useMatrixClient()
  const roomInfo = useRoomInfo(client, activeChannelId)
  const roomName = roomInfo?.name || ""

  if (!activeChannelId) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-12 items-center border-b border-nx-guild-bar px-2 md:hidden">
          <button onClick={onOpenNavigation} className="rounded p-1.5 text-muted-foreground" aria-label={t("nav.open")}>
            <Menu className="h-5 w-5" />
          </button>
        </header>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t("chat.selectRoom")}</div>
      </div>
    )
  }

  // Discord shows a voice channel full-screen, with its own header and controls.
  if (isInCallInActiveChannel) {
    return <CallArea onOpenNavigation={onOpenNavigation} />
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <header className="z-10 flex h-12 shrink-0 items-center justify-between gap-2 px-2 shadow-[0_1px_0_rgba(4,4,5,0.2),0_1.5px_0_rgba(6,6,7,0.05),0_2px_0_rgba(4,4,5,0.05)] sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onOpenNavigation}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
            aria-label={t("nav.open")}
          >
            <Menu className="h-5 w-5" />
          </button>
          {roomInfo?.isDirect ? (
            <AtSign className="h-6 w-6 shrink-0 text-muted-foreground" />
          ) : (
            <Hash className="h-6 w-6 shrink-0 text-muted-foreground" />
          )}
          <h3 className="truncate text-base font-semibold text-foreground">{roomName}</h3>
          {roomInfo?.isEncrypted && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={t("chat.encrypted")} />
              </TooltipTrigger>
              <TooltipContent>{t("chat.encrypted")}</TooltipContent>
            </Tooltip>
          )}
          {roomInfo?.topic && (
            <>
              <div className="mx-2 hidden h-6 w-px shrink-0 bg-border sm:block" />
              <span className="hidden truncate text-sm text-muted-foreground sm:block" title={roomInfo.topic}>
                {roomInfo.topic}
              </span>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {roomInfo?.exists && (
            <HeaderButton
              label={roomInfo.isDirect ? t("call.startCall") : t("call.joinVoice")}
              onClick={() => void joinCall(activeChannelId)}
              disabled={Boolean(joiningRoomId)}
            >
              {joiningRoomId === activeChannelId ? <Spinner className="h-5 w-5" /> : <Volume2 className="h-6 w-6" />}
            </HeaderButton>
          )}
          <HeaderButton label={t("members.list")} active={showMembers} onClick={onToggleMembers}>
            <Users className="h-6 w-6" />
          </HeaderButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <RoomChat key={activeChannelId} roomId={activeChannelId} />
        {showMembers && <MemberList activeRoomId={activeChannelId} className="hidden lg:flex" />}
      </div>
    </div>
  )
}
