"use client"

import { useEffect, useState } from "react"
import {
  RoomMemberEvent,
  RoomStateEvent,
  UserEvent,
  type MatrixClient,
} from "matrix-js-sdk"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"

interface MemberListProps {
  activeRoomId: string
  className?: string
}

type Presence = "online" | "unavailable" | "offline" | "unknown"

interface UiMember {
  userId: string
  name: string
  avatarMxc?: string
  presence: Presence
  powerLevel: number
}

const PRESENCE_COLORS: Record<Presence, string> = {
  online: "bg-nx-online",
  unavailable: "bg-nx-idle",
  offline: "bg-nx-offline",
  unknown: "bg-nx-offline",
}

const PRESENCE_LABELS: Record<Presence, string> = {
  online: "Online",
  unavailable: "Abwesend",
  offline: "Offline",
  unknown: "",
}

function readMembers(client: MatrixClient, roomId: string): UiMember[] {
  const room = client.getRoom(roomId)
  if (!room) return []

  return room
    .getJoinedMembers()
    .map((member) => {
      const user = client.getUser(member.userId)
      // Servers with presence disabled never send any; don't show everybody as offline then.
      const hasPresence = Boolean(user && (user.lastPresenceTs > 0 || user.currentlyActive))
      const presence: Presence = !hasPresence
        ? "unknown"
        : user?.presence === "online" || user?.currentlyActive
          ? "online"
          : user?.presence === "unavailable"
            ? "unavailable"
            : "offline"

      return {
        userId: member.userId,
        name: member.name || member.userId,
        avatarMxc: member.getMxcAvatarUrl() || undefined,
        presence,
        powerLevel: member.powerLevel,
      }
    })
    .sort((a, b) => b.powerLevel - a.powerLevel || a.name.localeCompare(b.name))
}

function useJoinedMembers(client: MatrixClient | null, roomId: string): UiMember[] {
  const [state, setState] = useState<{ roomId: string; members: UiMember[] } | null>(null)

  useEffect(() => {
    if (!client || !roomId) return
    let frame: number | null = null

    const refresh = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        setState({ roomId, members: readMembers(client, roomId) })
      })
    }

    refresh()
    // With lazy loading, the full member list has to be requested explicitly.
    client
      .getRoom(roomId)
      ?.loadMembersIfNeeded()
      .then(refresh)
      .catch((error: unknown) => console.warn("Failed to load room members:", error))

    client.on(RoomStateEvent.Members, refresh)
    client.on(RoomStateEvent.NewMember, refresh)
    client.on(RoomMemberEvent.Membership, refresh)
    client.on(RoomMemberEvent.Name, refresh)
    client.on(UserEvent.Presence, refresh)
    client.on(UserEvent.CurrentlyActive, refresh)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      client.removeListener(RoomStateEvent.Members, refresh)
      client.removeListener(RoomStateEvent.NewMember, refresh)
      client.removeListener(RoomMemberEvent.Membership, refresh)
      client.removeListener(RoomMemberEvent.Name, refresh)
      client.removeListener(UserEvent.Presence, refresh)
      client.removeListener(UserEvent.CurrentlyActive, refresh)
    }
  }, [client, roomId])

  return state && state.roomId === roomId ? state.members : []
}

function MemberItem({ member }: { member: UiMember }) {
  const isAway = member.presence === "offline"

  return (
    <div
      className={cn(
        "group flex w-full items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-nx-hover",
        isAway && "opacity-50 hover:opacity-100",
      )}
      title={member.userId}
    >
      <div className="relative">
        <MatrixAvatar mxcUrl={member.avatarMxc} name={member.name} size={32} />
        {member.presence !== "unknown" && (
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-[2.5px] border-nx-member-bg",
              PRESENCE_COLORS[member.presence],
            )}
          />
        )}
      </div>
      <div className="flex-1 overflow-hidden text-left">
        <p className="truncate text-sm font-medium text-foreground">{member.name}</p>
        {PRESENCE_LABELS[member.presence] && (
          <p className="truncate text-[11px] leading-tight text-muted-foreground">{PRESENCE_LABELS[member.presence]}</p>
        )}
      </div>
    </div>
  )
}

function MemberSection({ title, members }: { title: string; members: UiMember[] }) {
  if (members.length === 0) return null

  return (
    <div className="mb-2">
      <h4 className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {title} — {members.length}
      </h4>
      <div className="mt-1 flex flex-col">
        {members.map((member) => (
          <MemberItem key={member.userId} member={member} />
        ))}
      </div>
    </div>
  )
}

export function MemberList({ activeRoomId, className }: MemberListProps) {
  const { client } = useMatrixClient()
  const members = useJoinedMembers(client, activeRoomId)
  const presenceKnown = members.some((member) => member.presence !== "unknown")

  return (
    <aside className={cn("flex h-full w-60 flex-col bg-secondary", className)} aria-label="Mitglieder">
      <ScrollArea className="flex-1 px-2 pt-4">
        {presenceKnown ? (
          <>
            <MemberSection title="Anwesend" members={members.filter((member) => member.presence !== "offline")} />
            <MemberSection title="Offline" members={members.filter((member) => member.presence === "offline")} />
          </>
        ) : (
          <MemberSection title="Mitglieder" members={members} />
        )}
        <div className="h-4" />
      </ScrollArea>
    </aside>
  )
}
