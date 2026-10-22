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
import { Check, EyeOff, MessageCircle, UserMinus, UserPlus, Volume2 } from "lucide-react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/nexspeak/server-dialogs"
import { useIsIgnored } from "@/hooks/useIgnoredUsers"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { setIgnored } from "@nexspeak/core/matrix/safety"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { useCallContext } from "@/components/nexspeak/call-context"
import { useOpenDirectMessage } from "@/components/nexspeak/navigation-context"
import { useFriendActions, useFriendOf } from "@/components/nexspeak/friends-context"
import { PresenceAvatar, USER_PRESENCE_LABELS } from "@/components/nexspeak/presence-avatar"
import { loadOwnStatus, subscribeOwnStatus } from "@nexspeak/core/matrix/profile"
import { getUserStatus, getUserPresence, type UserPresence } from "@nexspeak/core/matrix/presence"
import { displayRole, MEMBER_ROLES_EVENT, memberRoles, readAssignedRoleIds, readRoles, ROLES_EVENT, type ServerRoleInfo } from "@nexspeak/core/matrix/roles"
import { RoleDot, roleLabel, RolePicker } from "@/components/nexspeak/server-roles"
import type { MessageKey } from "@nexspeak/i18n"

interface MemberListProps {
  activeRoomId: string
  /** The server of the room; roles come from there. Missing for DMs and rooms outside servers. */
  serverId?: string
  className?: string
}

interface UiMember {
  userId: string
  name: string
  avatarMxc?: string
  status: string
  presence: UserPresence
  powerLevel: number
  /** Highest first. */
  roles: ServerRoleInfo[]
  hoisted: ServerRoleInfo | null
  color?: string
}

function readMembers(client: MatrixClient, roomId: string, serverId: string | undefined): UiMember[] {
  const room = client.getRoom(roomId)
  if (!room) return []
  // Roles are server-wide, like the power levels they come from.
  const space = serverId ? client.getRoom(serverId) : null
  const roles = readRoles(space)

  return room
    .getJoinedMembers()
    .map((member) => {
      const powerLevel = space?.getMember(member.userId)?.powerLevel ?? member.powerLevel
      const shown = memberRoles(roles, space ? readAssignedRoleIds(space, member.userId) : null, powerLevel)
      return {
        userId: member.userId,
        name: member.name || member.userId,
        avatarMxc: member.getMxcAvatarUrl() || undefined,
        status: member.userId === client.getUserId() ? loadOwnStatus(client) : getUserStatus(client, member.userId),
        presence: getUserPresence(client, member.userId),
        powerLevel,
        roles: shown,
        ...displayRole(shown),
      }
    })
    .sort((a, b) => b.powerLevel - a.powerLevel || a.name.localeCompare(b.name))
}

const ROLE_STATE = new Set<string>([ROLES_EVENT, MEMBER_ROLES_EVENT, "m.room.power_levels"])

function useJoinedMembers(client: MatrixClient | null, roomId: string, serverId: string | undefined): UiMember[] {
  const [state, setState] = useState<{ roomId: string; members: UiMember[] } | null>(null)

  useEffect(() => {
    if (!client || !roomId) return
    let frame: number | null = null

    const refresh = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        setState({ roomId, members: readMembers(client, roomId, serverId) })
      })
    }

    refresh()
    // With lazy loading, the full member list has to be requested explicitly.
    client
      .getRoom(roomId)
      ?.loadMembersIfNeeded()
      .then(refresh)
      .catch((error: unknown) => console.warn("Failed to load room members:", error))

    const onState = (event: { getRoomId: () => string | undefined; getType: () => string }) => {
      const eventRoomId = event.getRoomId()
      if ((eventRoomId === roomId || eventRoomId === serverId) && ROLE_STATE.has(event.getType())) refresh()
    }
    client.on(RoomStateEvent.Events, onState)
    client.on(RoomStateEvent.Members, refresh)
    client.on(RoomStateEvent.NewMember, refresh)
    client.on(RoomMemberEvent.Membership, refresh)
    client.on(RoomMemberEvent.Name, refresh)
    const unsubscribeStatus = subscribeOwnStatus(refresh)
    client.on(UserEvent.LastPresenceTs, refresh)
    client.on(UserEvent.Presence, refresh)
    client.on(UserEvent.CurrentlyActive, refresh)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      client.removeListener(RoomStateEvent.Events, onState)
      client.removeListener(RoomStateEvent.Members, refresh)
      client.removeListener(RoomStateEvent.NewMember, refresh)
      client.removeListener(RoomMemberEvent.Membership, refresh)
      client.removeListener(RoomMemberEvent.Name, refresh)
      unsubscribeStatus()
      client.removeListener(UserEvent.LastPresenceTs, refresh)
      client.removeListener(UserEvent.Presence, refresh)
      client.removeListener(UserEvent.CurrentlyActive, refresh)
    }
  }, [client, roomId, serverId])

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

/** Add a friend, accept their request or remove them, depending on the friendship. */
function FriendButton({ userId, name }: { userId: string; name: string }) {
  const { t } = useTranslation()
  const friend = useFriendOf(userId)
  const actions = useFriendActions()
  const [isBusy, setIsBusy] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  const run = async (action: () => Promise<unknown>) => {
    setIsBusy(true)
    await action()
    setIsBusy(false)
  }

  const icon = isBusy ? <Spinner className="mr-2 h-4 w-4" /> : null
  if (friend?.status === "friend") {
    return (
      <>
        <Button className="w-full" size="sm" variant="outline" disabled={isBusy} onClick={() => setConfirmingRemove(true)}>
          {icon ?? <UserMinus className="mr-2 h-4 w-4" />}
          {t("friends.remove")}
        </Button>
        <ConfirmDialog
          open={confirmingRemove}
          onOpenChange={setConfirmingRemove}
          title={t("friends.removeConfirmTitle", { name })}
          description={t("friends.removeConfirmDescription")}
          confirmLabel={t("friends.remove")}
          onConfirm={() => void run(() => actions.remove(friend))}
        />
      </>
    )
  }
  if (friend?.status === "outgoing") {
    return (
      <Button className="w-full" size="sm" variant="outline" disabled>
        <Check className="mr-2 h-4 w-4" />
        {t("friends.requestPending")}
      </Button>
    )
  }
  if (friend?.status === "incoming") {
    return (
      <Button className="w-full" size="sm" variant="outline" disabled={isBusy} onClick={() => void run(() => actions.accept(friend))}>
        {icon ?? <UserPlus className="mr-2 h-4 w-4" />}
        {t("friends.acceptRequest")}
      </Button>
    )
  }
  return (
    <Button className="w-full" size="sm" variant="outline" disabled={isBusy} onClick={() => void run(() => actions.request([userId]))}>
      {icon ?? <UserPlus className="mr-2 h-4 w-4" />}
      {t("friends.add")}
    </Button>
  )
}

/** Discord's profile popout: who it is and a way to message them directly. */
function MemberProfile({ member, serverId, isSelf, onDone }: { member: UiMember; serverId?: string; isSelf: boolean; onDone: () => void }) {
  const { t } = useTranslation()
  const openDirectMessage = useOpenDirectMessage()
  const [isOpening, setIsOpening] = useState(false)
  const presenceLabel = USER_PRESENCE_LABELS[member.presence]

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
      {member.status && <p className="break-words text-sm text-foreground">{member.status}</p>}
      {serverId && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("members.roles")}</p>
          <ul className="flex flex-wrap gap-1">
            {(member.roles.length ? member.roles.map((role) => ({ key: role.id, color: role.color, label: roleLabel(role, t) })) : [{ key: "member", color: undefined, label: t("role.member") }]).map((role) => (
              <li key={role.key} className="flex items-center gap-1.5 rounded bg-accent px-1.5 py-0.5 text-xs">
                <RoleDot color={role.color} className="h-2.5 w-2.5" />
                {role.label}
              </li>
            ))}
          </ul>
          <RolePicker serverId={serverId} userId={member.userId} name={member.name} className="w-full" />
        </div>
      )}
      {!isSelf && (
        <div className="space-y-2">
          <Button className="w-full" size="sm" onClick={() => void message()} disabled={isOpening}>
            {isOpening ? <Spinner className="mr-2 h-4 w-4" /> : <MessageCircle className="mr-2 h-4 w-4" />}
            {t("dm.sendMessage")}
          </Button>
          <FriendButton userId={member.userId} name={member.name} />
          <IgnoreButton userId={member.userId} name={member.name} onDone={onDone} />
        </div>
      )}
    </div>
  )
}

function MemberItem({ member, serverId, voiceRoomName, isSelf }: { member: UiMember; serverId?: string; voiceRoomName?: string; isSelf: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const isAway = member.presence === "offline"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "group mx-2 flex min-h-[42px] items-center gap-3 rounded px-2 text-left transition-colors hover:bg-nx-hover",
            isAway && !voiceRoomName && "opacity-40 hover:opacity-100",
            open && "bg-nx-hover opacity-100",
          )}
          title={member.userId}
        >
          <PresenceAvatar
            mxcUrl={member.avatarMxc}
            name={member.name}
            presence={member.presence}
            dotClassName="border-secondary group-hover:border-nx-hover"
          />
          <div className="min-w-0 flex-1 text-left">
            <p
              className="truncate text-[15px] leading-5 font-medium text-muted-foreground group-hover:text-foreground"
              style={member.color ? { color: member.color } : undefined}
            >
              {member.name}
            </p>
            {member.status && <p className="truncate text-xs leading-4 text-muted-foreground" title={member.status}>{member.status}</p>}
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
        <MemberProfile member={member} serverId={serverId} isSelf={isSelf} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

function MemberSection({
  title,
  members,
  serverId,
  voiceRoomByUser,
  ownUserId,
}: {
  title: string
  members: UiMember[]
  serverId?: string
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
            serverId={serverId}
            voiceRoomName={voiceRoomByUser.get(member.userId)}
            isSelf={member.userId === ownUserId}
          />
        ))}
      </div>
    </div>
  )
}

type MemberGroup = { key: string; title: string; members: UiMember[] }

/** Like Discord: by the highest role shown separately, the rest online, then everybody offline. */
function groupMembers(members: UiMember[], presenceKnown: boolean, t: ReturnType<typeof useTranslation>["t"]): MemberGroup[] {
  const byRole = new Map<string, { role: ServerRoleInfo; members: UiMember[] }>()
  const rest: UiMember[] = []
  const offline: UiMember[] = []
  members.forEach((member) => {
    if (presenceKnown && member.presence === "offline") offline.push(member)
    else if (member.hoisted) {
      const group = byRole.get(member.hoisted.id) ?? { role: member.hoisted, members: [] }
      group.members.push(member)
      byRole.set(member.hoisted.id, group)
    } else rest.push(member)
  })
  const restKey: MessageKey = presenceKnown ? "presence.online" : "members.title"
  return [
    ...[...byRole.values()]
      .sort((a, b) => b.role.level - a.role.level)
      .map(({ role, members: grouped }) => ({ key: `role:${role.id}`, title: roleLabel(role, t), members: grouped })),
    { key: restKey, title: t(restKey), members: rest },
    { key: "presence.offline", title: t("presence.offline"), members: offline },
  ]
}

export function MemberList({ activeRoomId, serverId, className }: MemberListProps) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const { callInfoByRoom } = useCallContext()
  const ownUserId = client?.getUserId() ?? ""
  const members = useJoinedMembers(client, activeRoomId, serverId)
  const presenceKnown = members.some((member) => member.presence !== "unknown")

  const voiceRoomByUser = new Map<string, string>()
  Object.entries(callInfoByRoom).forEach(([roomId, info]) => {
    const roomName = client?.getRoom(roomId)?.name || ""
    info.members.forEach((member) => voiceRoomByUser.set(member.userId, roomName))
  })

  return (
    <aside className={cn("flex h-full w-60 shrink-0 flex-col bg-secondary", className)} aria-label={t("members.title")}>
      <ScrollArea className="min-h-0 flex-1">
        {groupMembers(members, presenceKnown, t).map((group) => (
          <MemberSection
            key={group.key}
            title={group.title}
            members={group.members}
            serverId={serverId}
            voiceRoomByUser={voiceRoomByUser}
            ownUserId={ownUserId}
          />
        ))}
        <div className="h-4" />
      </ScrollArea>
    </aside>
  )
}
