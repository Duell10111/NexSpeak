"use client"

import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Hash, ChevronDown, Settings, Mic, Headphones, Search } from "lucide-react"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useDirectRoomList, useRoomList, useSpaceList } from "@/hooks/useRoomMembers"
import { getDisplayName, getAvatarUrl } from "@/lib/matrix/client"
import { DIRECT_MESSAGES_ID, type MatrixRoom } from '@/lib/matrix/types'

interface ChannelSidebarProps {
  activeServerId: string
  activeChannelId: string
  onChannelSelect: (id: string) => void
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: "bg-nx-online",
    idle: "bg-nx-idle",
    dnd: "bg-nx-dnd",
    offline: "bg-nx-offline",
  }
  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-secondary",
        colors[status] || colors.offline
      )}
    />
  )
}

function RoomItem({ room, isActive, onSelect }: { room: MatrixRoom; isActive: boolean; onSelect: () => void }) {
  const Icon = Hash
  const unread = room.unread || 0

  return (
    <button
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        isActive
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-nx-hover hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-70" />
      <span className="truncate">{room.name || room.id}</span>
      {unread > 0 && !isActive && (
        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
          {unread}
        </span>
      )}
    </button>
  )
}

export function ChannelSidebar({ activeServerId, activeChannelId, onChannelSelect }: ChannelSidebarProps) {
  const { client } = useMatrixClient()
  const { rooms } = useRoomList(client)
  const { rooms: directRooms } = useDirectRoomList(client)
  const { spaces, roomsBySpace } = useSpaceList(client)

  const isDirectMessages = activeServerId === DIRECT_MESSAGES_ID
  const selectedSpaceRooms = activeServerId ? roomsBySpace[activeServerId] : undefined
  const directRoomIds = new Set(directRooms.map((room) => room.id))
  const nonDirectRooms = rooms.filter((room) => !directRoomIds.has(room.id))

  // Important: in a space context never fall back to the full room list, otherwise DMs can leak into server view.
  const roomList = isDirectMessages
    ? directRooms
    : selectedSpaceRooms
      ? selectedSpaceRooms
      : nonDirectRooms
  const activeSpace = spaces.find((space) => space.id === activeServerId)

  // Display current user's info if available
  const userId = client?.getUserId() ?? ''
  const displayName = client && userId ? getDisplayName(client, userId) : undefined
  const avatarUrl = client && userId ? getAvatarUrl(client, userId, 32) : undefined

  return (
    <div className="flex h-full w-60 flex-col bg-secondary">
      {/* Server header - keep simple */}
      <div className="flex h-12 items-center justify-between border-b border-border px-4 shadow-sm">
        <h2 className="truncate text-[15px] font-semibold text-foreground">
          {isDirectMessages ? "Direktnachrichten" : activeSpace?.name || "Rooms"}
        </h2>
        <ChevronDown className="h-4 w-4 text-foreground" />
      </div>

      {/* Rooms */}
      <ScrollArea className="flex-1 px-2">
        {/* Search */}
        <button className="mt-3 flex w-full items-center gap-2 rounded-md bg-input px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-nx-chat-input">
          <Search className="h-3.5 w-3.5" />
          <span>Suchen</span>
        </button>

        <div className="mt-4 flex flex-col gap-0.5">
          {roomList.map((room) => (
            <RoomItem
              key={room.id}
              room={room}
              isActive={activeChannelId === room.id}
              onSelect={() => onChannelSelect(room.id)}
            />
          ))}
        </div>

        <div className="h-4" />
      </ScrollArea>

      {/* User panel at bottom: uses real Matrix user info when available */}
      <div className="flex items-center gap-2 border-t border-border bg-popover px-2 py-2">
        <div className="relative">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground overflow-hidden">
            {avatarUrl ? <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" /> : (displayName ? displayName.charAt(0).toUpperCase() : "?")}
          </div>
          <StatusDot status={"online"} />
        </div>
        <div className="flex-1 overflow-hidden">
          <p className="truncate text-sm font-semibold text-foreground leading-tight">
            {displayName || (client ? client.getUserId() : 'Not connected')}
          </p>
          <p className="truncate text-[11px] text-muted-foreground leading-tight">Online</p>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" aria-label="Mikrofon">
                <Mic className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Mikrofon</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" aria-label="Kopfhoerer">
                <Headphones className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Kopfhoerer</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" aria-label="Einstellungen">
                <Settings className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Einstellungen</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
