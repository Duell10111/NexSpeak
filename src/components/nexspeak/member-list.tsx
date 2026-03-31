"use client"

import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { RoomMember } from 'matrix-js-sdk'
import { useMatrixClient } from '@/hooks/useMatrixClient'

interface MemberListProps {
  activeRoomId: string
}

function StatusDot({ status, className }: { status?: string; className?: string }) {
  const colors: Record<string, string> = {
    online: "bg-nx-online",
    idle: "bg-nx-idle",
    dnd: "bg-nx-dnd",
    offline: "bg-nx-offline",
  }
  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-[2.5px] border-nx-member-bg",
        colors[status || 'offline'],
        className
      )}
    />
  )
}

function MemberItem({ name, avatar, status }: { name: string; avatar?: string; status?: string }) {
  return (
    <button className="group flex w-full items-center gap-3 rounded-md px-2 py-1.5 hover:bg-nx-hover transition-colors">
      <div className="relative">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold bg-muted text-foreground overflow-hidden")}>
          {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : name.charAt(0).toUpperCase()}
        </div>
        <StatusDot status={status} />
      </div>
      <div className="flex-1 overflow-hidden text-left">
        <p className={cn("truncate text-sm font-medium transition-colors", "group-hover:text-foreground")}>
          {name}
        </p>
        {status && (
          <p className="truncate text-[11px] text-muted-foreground leading-tight">
            {status === 'dnd' ? 'Bitte nicht stören' : status}
          </p>
        )}
      </div>
    </button>
  )
}

export function MemberList({ activeRoomId }: MemberListProps) {
  const { client } = useMatrixClient()
  const room = client && activeRoomId ? client.getRoom(activeRoomId) : null

  const toUiMember = (m: RoomMember) => {
    const displayName = m.name || m.userId || m.getUserId?.()
    const avatar = client && m.getAvatarUrl ? m.getAvatarUrl(client.getHomeserverUrl(), 32, 32, 'crop') : undefined
    const status = (m.presence || undefined) as string | undefined
    return { name: displayName, avatar, status }
  }

  const members = room ? room.getMembers().map(toUiMember) : []

  // Split online/offline
  const online = members.filter((m) => m.status && m.status !== 'offline')
  const offline = members.filter((m) => !m.status || m.status === 'offline')

  return (
    <div className="flex h-full w-60 flex-col bg-secondary">
      <ScrollArea className="flex-1 px-2 pt-4">
        {online.length > 0 && (
          <div className="mb-2">
            <h4 className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Anwesend — {online.length}</h4>
            <div className="mt-1 flex flex-col">
              {online.map((m, i) => (
                <MemberItem key={`on-${i}-${m.name}`} name={m.name} avatar={m.avatar} status={m.status} />
              ))}
            </div>
          </div>
        )}

        {offline.length > 0 && (
          <div className="mb-2">
            <h4 className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Offline — {offline.length}</h4>
            <div className="mt-1 flex flex-col">
              {offline.map((m, i) => (
                <MemberItem key={`off-${i}-${m.name}`} name={m.name} avatar={m.avatar} status={m.status} />
              ))}
            </div>
          </div>
        )}

        <div className="h-4" />
      </ScrollArea>
    </div>
  )
}
