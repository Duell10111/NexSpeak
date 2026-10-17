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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { EyeOff, MessageCircle, Volume2 } from "lucide-react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/nexspeak/server-dialogs"
import { useIsIgnored } from "@/hooks/useIgnoredUsers"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { setIgnored } from "@nexspeak/core/matrix/safety"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { useCallContext } from "@/components/nexspeak/call-context"
import { useOpenDirectMessage } from "@/components/nexspeak/navigation-context"
import type { MessageKey } from "@nexspeak/i18n"

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

const PRESENCE_LABELS: Record<Presence, MessageKey | null> = {
  online: "presence.online",
  unavailable: "presence.away",
  offline: "presence.offline",
  unknown: null,
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

/** Ignore (after confirming) or stop ignoring someone; shared by profile popouts. */
export function IgnoreButton({ userId, name, onDone }: { userId: string; name: string; onDone?: () => void }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const [confirming, setConfirming] = useState(false)
  const ignored = useIsIgnored(client, userId)

  const apply = (ignore: boolean) => {
    setConfirming(false)
    if (!client) return
    setIgnored(client, userId, ignore)
      .then(() => {
        toast.success(t(ignore ? "ignore.ignored" : "ignore.unignored", { name }))
        onDone?.()
      })
      .catch((error: unknown) => toast.error(describeMatrixError(error, t("ignore.failed"))))
  }

  return (
    <>
      <Button
        className="w-full"
        size="sm"
        variant="outline"
        onClick={() => (ignored ? apply(false) : setConfirming(true))}
      >
        <EyeOff className="mr-2 h-4 w-4" />
        {ignored ? t("ignore.unignore") : t("ignore.ignore")}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("ignore.confirmTitle", { name })}
        description={t("ignore.confirmDescription")}
        confirmLabel={t("ignore.ignore")}
        onConfirm={() => apply(true)}
      />
    </>
  )
}

/** Discord's profile popout: who it is and a way to message them directly. */
function MemberProfile({ member, isSelf, onDone }: { member: UiMember; isSelf: boolean; onDone: () => void }) {
  const { t } = useTranslation()
  const openDirectMessage = useOpenDirectMessage()
  const [isOpening, setIsOpening] = useState(false)
  const presenceLabel = PRESENCE_LABELS[member.presence]

  const message = async () => {
    setIsOpening(true)
    const opened = await openDirectMessage([member.userId])
    setIsOpening(false)
    if (opened) onDone()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <MatrixAvatar mxcUrl={member.avatarMxc} name={member.name} size={56} className="text-lg" />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-foreground">{member.name}</p>
          <p className="truncate text-xs text-muted-foreground">{member.userId}</p>
          {presenceLabel && <p className="text-xs text-muted-foreground">{t(presenceLabel)}</p>}
        </div>
      </div>
      {!isSelf && (
        <div className="space-y-2">
          <Button className="w-full" size="sm" onClick={() => void message()} disabled={isOpening}>
            {isOpening ? <Spinner className="mr-2 h-4 w-4" /> : <MessageCircle className="mr-2 h-4 w-4" />}
            {t("dm.sendMessage")}
          </Button>
          <IgnoreButton userId={member.userId} name={member.name} onDone={onDone} />
        </div>
      )}
    </div>
  )
}

function MemberItem({ member, voiceRoomName, isSelf }: { member: UiMember; voiceRoomName?: string; isSelf: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const isAway = member.presence === "offline"
  const presenceLabel = PRESENCE_LABELS[member.presence]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "group mx-2 flex h-[42px] items-center gap-3 rounded px-2 text-left transition-colors hover:bg-nx-hover",
            isAway && !voiceRoomName && "opacity-40 hover:opacity-100",
            open && "bg-nx-hover opacity-100",
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
                aria-label={presenceLabel ? t(presenceLabel) : undefined}
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
                <span className="truncate">{t("members.inVoice", { name: voiceRoomName })}</span>
              </p>
            )}
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-72">
        <MemberProfile member={member} isSelf={isSelf} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

function MemberSection({
  title,
  members,
  voiceRoomByUser,
  ownUserId,
}: {
  title: string
  members: UiMember[]
  voiceRoomByUser: Map<string, string>
  ownUserId: string
}) {
  if (members.length === 0) return null

  return (
    <div>
      <h4 className="truncate px-4 pt-6 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title} — {members.length}
      </h4>
      <div className="flex flex-col gap-0.5">
        {members.map((member) => (
          <MemberItem
            key={member.userId}
            member={member}
            voiceRoomName={voiceRoomByUser.get(member.userId)}
            isSelf={member.userId === ownUserId}
          />
        ))}
      </div>
    </div>
  )
}

/** Discord groups members by their highest role; power levels are Matrix' roles. */
function roleTitle(powerLevel: number): MessageKey | null {
  if (powerLevel >= 100) return "members.admin"
  if (powerLevel >= 50) return "members.moderator"
  return null
}

function groupMembers(members: UiMember[], presenceKnown: boolean): Array<{ title: MessageKey; members: UiMember[] }> {
  const groups = new Map<MessageKey, UiMember[]>()
  const add = (title: MessageKey, member: UiMember) => groups.set(title, [...(groups.get(title) ?? []), member])

  members.forEach((member) => {
    // Like Discord, offline members are listed together regardless of their role.
    if (presenceKnown && member.presence === "offline") return
    add(roleTitle(member.powerLevel) ?? (presenceKnown ? "presence.online" : "members.title"), member)
  })
  if (presenceKnown) members.filter((member) => member.presence === "offline").forEach((member) => add("presence.offline", member))

  return Array.from(groups, ([title, grouped]) => ({ title, members: grouped }))
}

export function MemberList({ activeRoomId, className }: MemberListProps) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const { callInfoByRoom } = useCallContext()
  const ownUserId = client?.getUserId() ?? ""
  const members = useJoinedMembers(client, activeRoomId)
  const presenceKnown = members.some((member) => member.presence !== "unknown")

  const voiceRoomByUser = new Map<string, string>()
  Object.entries(callInfoByRoom).forEach(([roomId, info]) => {
    const roomName = client?.getRoom(roomId)?.name || ""
    info.members.forEach((member) => voiceRoomByUser.set(member.userId, roomName))
  })

  return (
    <aside className={cn("flex h-full w-60 shrink-0 flex-col bg-secondary", className)} aria-label={t("members.title")}>
      <ScrollArea className="min-h-0 flex-1">
        {groupMembers(members, presenceKnown).map((group) => (
          <MemberSection
            key={group.title}
            title={t(group.title)}
            members={group.members}
            voiceRoomByUser={voiceRoomByUser}
            ownUserId={ownUserId}
          />
        ))}
        <div className="h-4" />
      </ScrollArea>
    </aside>
  )
}
