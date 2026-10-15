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
import { Volume2 } from "lucide-react"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { useCallContext } from "@/components/nexspeak/call-context"

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

function MemberItem({ member, voiceRoomName }: { member: UiMember; voiceRoomName?: string }) {
  const isAway = member.presence === "offline"

  return (
    <div
      className={cn(
        "group mx-2 flex h-[42px] items-center gap-3 rounded px-2 transition-colors hover:bg-nx-hover",
        isAway && !voiceRoomName && "opacity-40 hover:opacity-100",
      )}
      title={member.userId}
    >
      <div className="relative">
        <MatrixAvatar mxcUrl={member.avatarMxc} name={member.name} size={32} />
        {member.presence !== "unknown" && (
          <span
            className={cn(
              "absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-secondary group-hover:border-nx-hover",
              PRESENCE_COLORS[member.presence],
            )}
            aria-label={PRESENCE_LABELS[member.presence]}
          />
        )}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-[15px] leading-5 font-medium text-muted-foreground group-hover:text-foreground">
          {member.name}
        </p>
        {voiceRoomName && (
          <p className="flex items-center gap-1 truncate text-xs leading-4 text-muted-foreground">
            <Volume2 className="h-3 w-3 shrink-0 text-nx-online" />
            <span className="truncate">Im Sprachkanal {voiceRoomName}</span>
          </p>
        )}
      </div>
    </div>
  )
}

function MemberSection({
  title,
  members,
  voiceRoomByUser,
}: {
  title: string
  members: UiMember[]
  voiceRoomByUser: Map<string, string>
}) {
  if (members.length === 0) return null

  return (
    <div>
      <h4 className="truncate px-4 pt-6 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title} — {members.length}
      </h4>
      <div className="flex flex-col gap-0.5">
        {members.map((member) => (
          <MemberItem key={member.userId} member={member} voiceRoomName={voiceRoomByUser.get(member.userId)} />
        ))}
      </div>
    </div>
  )
}

/** Discord groups members by their highest role; power levels are Matrix' roles. */
function roleTitle(powerLevel: number): string | null {
  if (powerLevel >= 100) return "Admin"
  if (powerLevel >= 50) return "Moderator"
  return null
}

function groupMembers(members: UiMember[], presenceKnown: boolean): Array<{ title: string; members: UiMember[] }> {
  const groups = new Map<string, UiMember[]>()
  const add = (title: string, member: UiMember) => groups.set(title, [...(groups.get(title) ?? []), member])

  members.forEach((member) => {
    // Like Discord, offline members are listed together regardless of their role.
    if (presenceKnown && member.presence === "offline") return
    add(roleTitle(member.powerLevel) ?? (presenceKnown ? "Online" : "Mitglieder"), member)
  })
  if (presenceKnown) members.filter((member) => member.presence === "offline").forEach((member) => add("Offline", member))

  return Array.from(groups, ([title, grouped]) => ({ title, members: grouped }))
}

export function MemberList({ activeRoomId, className }: MemberListProps) {
  const { client } = useMatrixClient()
  const { callInfoByRoom } = useCallContext()
  const members = useJoinedMembers(client, activeRoomId)
  const presenceKnown = members.some((member) => member.presence !== "unknown")

  const voiceRoomByUser = new Map<string, string>()
  Object.entries(callInfoByRoom).forEach(([roomId, info]) => {
    const roomName = client?.getRoom(roomId)?.name || ""
    info.members.forEach((member) => voiceRoomByUser.set(member.userId, roomName))
  })

  return (
    <aside className={cn("flex h-full w-60 shrink-0 flex-col bg-secondary", className)} aria-label="Mitglieder">
      <ScrollArea className="min-h-0 flex-1">
        {groupMembers(members, presenceKnown).map((group) => (
          <MemberSection key={group.title} title={group.title} members={group.members} voiceRoomByUser={voiceRoomByUser} />
        ))}
        <div className="h-4" />
      </ScrollArea>
    </aside>
  )
}
