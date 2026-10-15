"use client"

import { useEffect, useState } from "react"
import { UserEvent, type MatrixClient } from "matrix-js-sdk"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Check, Hash, HeadphoneOff, Headphones, Mic, MicOff, Phone, PhoneOff, Settings, X } from "lucide-react"
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

function RoomItem({
  room,
  isActive,
  isDirectMessages,
  callInfo,
  onSelect,
  onDoubleClick,
}: {
  room: MatrixRoom
  isActive: boolean
  isDirectMessages: boolean
  callInfo?: RoomCallInfo | null
  onSelect: () => void
  onDoubleClick?: () => void
}) {
  const hasUnread = room.unread > 0 && !isActive

  return (
    <button
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        isActive
          ? "bg-muted text-foreground"
          : hasUnread
            ? "font-semibold text-foreground hover:bg-nx-hover"
            : "text-muted-foreground hover:bg-nx-hover hover:text-foreground",
      )}
      aria-current={isActive ? "page" : undefined}
      title={isDirectMessages ? undefined : "Doppelklick, um dem Sprachkanal beizutreten"}
    >
      <div className="flex items-center gap-1.5">
        {isDirectMessages ? (
          <MatrixAvatar mxcUrl={room.avatarMxc} name={room.name} size={24} className="mr-1 text-[10px]" />
        ) : (
          <Hash className="h-4 w-4 shrink-0 opacity-70" />
        )}
        <span className="truncate">{room.name}</span>
        {hasUnread && (room.highlights > 0 || isDirectMessages) && (
          <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {isDirectMessages ? room.unread : room.highlights}
          </span>
        )}
      </div>

      {callInfo && (
        <div className="mt-1 flex items-center gap-1.5 pl-5 text-[11px] text-muted-foreground/90">
          <Phone className="h-3 w-3" />
          <span className="truncate">{callInfo.names.length > 0 ? callInfo.names.join(", ") : "Aktiver Call"}</span>
        </div>
      )}
    </button>
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
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
      <MatrixAvatar mxcUrl={room.avatarMxc} name={room.name} size={24} className="text-[10px]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground">{room.name}</p>
        {room.inviter && <p className="truncate text-[11px] text-muted-foreground">von {room.inviter}</p>}
      </div>
      <button
        onClick={() => void respond(true)}
        disabled={isBusy}
        className="rounded p-1 text-nx-online hover:bg-muted disabled:opacity-50"
        aria-label="Einladung annehmen"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        onClick={() => void respond(false)}
        disabled={isBusy}
        className="rounded p-1 text-destructive hover:bg-muted disabled:opacity-50"
        aria-label="Einladung ablehnen"
      >
        <X className="h-4 w-4" />
      </button>
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
  const { client } = useMatrixClient()
  const profile = useOwnProfile(client)
  const { callInfoByRoom, call, joinCall, leaveCall, toggleMicrophone, toggleDeafen } = useCallContext()
  const isMicMuted = call?.isMicMuted ?? false
  const isDeafened = call?.isDeafened ?? false

  const isEmpty = sections.every((section) => section.rooms.length === 0) && invites.length === 0

  return (
    <div className="flex h-full w-60 shrink-0 flex-col bg-secondary">
      <div className="flex h-12 items-center border-b border-border px-4 shadow-sm">
        <h2 className="truncate text-[15px] font-semibold text-foreground">{title}</h2>
      </div>

      <ScrollArea className="flex-1 px-2">
        {invites.length > 0 && (
          <div className="mt-4">
            <h3 className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Einladungen — {invites.length}
            </h3>
            <div className="mt-1 flex flex-col gap-0.5">
              {invites.map((room) => (
                <InviteItem key={room.id} room={room} onAccepted={onChannelSelect} />
              ))}
            </div>
          </div>
        )}

        {sections.map(
          (section) =>
            section.rooms.length > 0 && (
              <div key={section.id} className="mt-4">
                {section.title && (
                  <h3 className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{section.title}</h3>
                )}
                <div className="mt-1 flex flex-col gap-0.5">
                  {section.rooms.map((room) => (
                    <RoomItem
                      key={room.id}
                      room={room}
                      isActive={activeChannelId === room.id}
                      isDirectMessages={isDirectMessages}
                      callInfo={callInfoByRoom[room.id]}
                      onSelect={() => onChannelSelect(room.id)}
                      onDoubleClick={isDirectMessages ? undefined : () => void joinCall(room.id)}
                    />
                  ))}
                </div>
              </div>
            ),
        )}

        {isEmpty && (
          <p className="mt-6 px-2 text-center text-xs text-muted-foreground">
            {isDirectMessages ? "Noch keine Direktnachrichten." : "Dieser Server hat keine Räume, denen du beigetreten bist."}
          </p>
        )}

        <div className="h-4" />
      </ScrollArea>

      {/* Voice connection panel */}
      {call && (
        <div className="flex items-center gap-2 border-t border-border bg-popover px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className={cn("text-xs font-semibold", call.connectionState === "reconnecting" ? "text-nx-idle" : "text-nx-online")}>
              {call.connectionState === "reconnecting" ? "Verbindung wird wiederhergestellt…" : "Sprachverbindung aktiv"}
            </p>
            <button
              onClick={() => onChannelSelect(call.roomId)}
              className="block max-w-full truncate text-[11px] text-muted-foreground hover:underline"
            >
              {client?.getRoom(call.roomId)?.name || "Sprachkanal"}
            </button>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={leaveCall}
                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                aria-label="Verbindung trennen"
              >
                <PhoneOff className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Verbindung trennen</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* User panel */}
      <div className="flex items-center gap-2 border-t border-border bg-popover px-2 py-2">
        <MatrixAvatar mxcUrl={profile?.avatarMxc} name={profile?.name || "?"} size={32} />
        <div className="flex-1 overflow-hidden">
          <p className="truncate text-sm font-semibold leading-tight text-foreground">{profile?.name || "…"}</p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">{profile?.userId}</p>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => void toggleMicrophone()}
                disabled={!call}
                className={cn(
                  "rounded p-1 transition-colors disabled:opacity-40",
                  isMicMuted
                    ? "text-destructive hover:bg-destructive/10"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                aria-label={isMicMuted ? "Mikrofon aktivieren" : "Mikrofon stummschalten"}
                aria-pressed={isMicMuted}
              >
                {isMicMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {!call ? "Kein aktiver Call" : isMicMuted ? "Mikrofon aktivieren" : "Mikrofon stummschalten"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleDeafen}
                disabled={!call}
                className={cn(
                  "rounded p-1 transition-colors disabled:opacity-40",
                  isDeafened
                    ? "text-destructive hover:bg-destructive/10"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                aria-label={isDeafened ? "Ton aktivieren" : "Ton stummschalten"}
                aria-pressed={isDeafened}
              >
                {isDeafened ? <HeadphoneOff className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{isDeafened ? "Ton aktivieren" : "Ton stummschalten"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSettingsOpen(true)}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Einstellungen"
              >
                <Settings className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Einstellungen</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
