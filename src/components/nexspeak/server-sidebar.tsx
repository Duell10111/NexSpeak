"use client"

import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Plus } from "lucide-react"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useMediaUrl } from "@/hooks/useMediaUrl"
import { describeMatrixError } from "@/lib/matrix/errors"
import { DIRECT_MESSAGES_ID, type MatrixSpace } from "@/lib/matrix/types"

interface ServerSidebarProps {
  spaces: MatrixSpace[]
  activeServerId: string
  homeUnread: number
  onServerSelect: (id: string) => void
  onRoomJoined: (roomId: string) => void
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

function ServerIcon({
  server,
  isActive,
  onClick,
}: {
  server: MatrixSpace
  isActive: boolean
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
            <UnreadBadge mentions={server.mentions} unread={server.unread} isActive={isActive} />
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="font-semibold">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function JoinRoomDialog({
  open,
  onOpenChange,
  onJoined,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onJoined: (roomId: string) => void
}) {
  const { client } = useMatrixClient()
  const [address, setAddress] = useState("")
  const [isJoining, setIsJoining] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const target = address.trim()
    if (!client || !target) return

    if (!/^[#!][^:]+:.+$/.test(target)) {
      toast.error("Bitte gib eine Adresse wie #raum:server.org oder eine Raum-ID an.")
      return
    }

    setIsJoining(true)
    try {
      const room = await client.joinRoom(target)
      toast.success(`${room.name || target} beigetreten`)
      setAddress("")
      onOpenChange(false)
      onJoined(room.roomId)
    } catch (error) {
      toast.error(describeMatrixError(error, "Beitritt fehlgeschlagen."))
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader>
            <DialogTitle>Server oder Raum beitreten</DialogTitle>
            <DialogDescription>Gib die Adresse eines Matrix-Space oder -Raums ein.</DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-2">
            <Label htmlFor="join-address">Adresse</Label>
            <Input
              id="join-address"
              placeholder="#community:matrix.org"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              disabled={isJoining}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isJoining || !address.trim()}>
              {isJoining && <Spinner className="mr-2 h-4 w-4" />}
              Beitreten
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ServerSidebar({ spaces, activeServerId, homeUnread, onServerSelect, onRoomJoined }: ServerSidebarProps) {
  const [joinOpen, setJoinOpen] = useState(false)
  const isHomeActive = activeServerId === DIRECT_MESSAGES_ID

  return (
    <nav
      className="flex h-full w-[72px] shrink-0 flex-col items-center overflow-y-auto bg-nx-guild-bar py-3"
      aria-label="Server-Liste"
    >
      {/* Home / DM button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => onServerSelect(DIRECT_MESSAGES_ID)}
            className={cn(
              "relative mx-3 mb-2 flex h-12 w-12 items-center justify-center rounded-[16px] text-lg font-bold transition-all hover:rounded-[12px]",
              isHomeActive
                ? "bg-primary text-primary-foreground"
                : "bg-nx-guild-bar text-foreground hover:bg-primary hover:text-primary-foreground",
            )}
            aria-label="Direktnachrichten"
            aria-current={isHomeActive ? "page" : undefined}
          >
            <svg width="28" height="20" viewBox="0 0 28 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M5.88 0h2.68l3.22 11.02L15.1 0h2.5l3.32 11.02L24.14 0h2.68L22.2 20h-2.48L16.3 8.58 12.88 20h-2.48L5.88 0z" fill="currentColor" />
            </svg>
            <UnreadBadge mentions={homeUnread} unread={0} isActive={isHomeActive} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-semibold">
          Direktnachrichten
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
            onClick={() => onServerSelect(server.id)}
          />
        ))}
      </div>

      {spaces.length > 0 && (
        <div className="mx-auto mt-2 w-8">
          <Separator className="bg-border" />
        </div>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setJoinOpen(true)}
            className="mx-3 mt-2 flex h-12 w-12 items-center justify-center rounded-[24px] bg-nx-guild-bar text-nx-online transition-all hover:rounded-[16px] hover:bg-nx-online hover:text-primary-foreground"
            aria-label="Server beitreten"
          >
            <Plus className="h-5 w-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-semibold">
          Server beitreten
        </TooltipContent>
      </Tooltip>

      <JoinRoomDialog open={joinOpen} onOpenChange={setJoinOpen} onJoined={onRoomJoined} />
    </nav>
  )
}
