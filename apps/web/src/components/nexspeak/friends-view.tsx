"use client"

import { useState } from "react"
import { Check, Menu, MessageCircle, MoreVertical, Phone, Users, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { usePresence } from "@/hooks/usePresence"
import { useTranslation } from "@/hooks/useTranslation"
import { useCallContext } from "@/components/nexspeak/call-context"
import { useNavigation } from "@/components/nexspeak/navigation-context"
import { useFriendActions, useFriends } from "@/components/nexspeak/friends-context"
import { PresenceAvatar, USER_PRESENCE_LABELS } from "@/components/nexspeak/presence-avatar"
import { ConfirmDialog } from "@/components/nexspeak/server-dialogs"
import { UserPickerDialog } from "@/components/nexspeak/user-picker-dialog"
import type { Friend } from "@nexspeak/core/matrix/friends"
import type { UserPresence } from "@nexspeak/core/matrix/presence"
import { DIRECT_MESSAGES_ID } from "@nexspeak/core/matrix/types"
import type { MessageKey } from "@nexspeak/i18n"

type FriendsTab = "online" | "all" | "pending"

const TAB_LABELS: Record<FriendsTab, MessageKey> = {
  online: "friends.online",
  all: "friends.all",
  pending: "friends.pending",
}

const TAB_COUNTS: Record<FriendsTab, MessageKey> = {
  online: "friends.countOnline",
  all: "friends.countAll",
  pending: "friends.countPending",
}

const TAB_EMPTY: Record<FriendsTab, MessageKey> = {
  online: "friends.emptyOnline",
  all: "friends.emptyAll",
  pending: "friends.emptyPending",
}

function RowButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
            className,
          )}
          aria-label={label}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function FriendRow({ friend, presence }: { friend: Friend; presence: UserPresence }) {
  const { t } = useTranslation()
  const actions = useFriendActions()
  const { openRoom } = useNavigation()
  const { joinCall, joiningRoomId } = useCallContext()
  const [isBusy, setIsBusy] = useState(false)
  const [confirm, setConfirm] = useState<"remove" | "block" | null>(null)
  const name = friend.name
  const presenceLabel = USER_PRESENCE_LABELS[presence]

  const busy = (action: (friend: Friend) => Promise<void>) => async () => {
    setIsBusy(true)
    await action(friend)
    setIsBusy(false)
  }

  const subtitle =
    friend.status === "incoming"
      ? t("friends.incoming")
      : friend.status === "outgoing"
        ? t("friends.outgoing")
        : presenceLabel
          ? t(presenceLabel)
          : friend.userId

  return (
    <div className="group mx-2 flex h-[62px] items-center gap-3 rounded border-t border-border px-2 hover:rounded-lg hover:border-transparent hover:bg-nx-hover">
      <PresenceAvatar
        mxcUrl={friend.avatarMxc}
        name={name}
        presence={friend.status === "friend" ? presence : "unknown"}
        dotClassName="border-background group-hover:border-nx-hover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-foreground" title={friend.userId}>
          {name}
        </p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {friend.status === "friend" && (
          <>
            <RowButton label={t("friends.messageNamed", { name })} onClick={() => openRoom(friend.roomId, DIRECT_MESSAGES_ID)}>
              <MessageCircle className="h-4 w-4" />
            </RowButton>
            <RowButton
              label={t("friends.callNamed", { name })}
              disabled={Boolean(joiningRoomId)}
              onClick={() => {
                openRoom(friend.roomId, DIRECT_MESSAGES_ID)
                void joinCall(friend.roomId)
              }}
            >
              <Phone className="h-4 w-4" />
            </RowButton>
          </>
        )}
        {friend.status === "incoming" && (
          <>
            <RowButton
              label={t("friends.acceptNamed", { name })}
              onClick={() => void busy(actions.accept)()}
              disabled={isBusy}
              className="hover:text-nx-online"
            >
              <Check className="h-4 w-4" />
            </RowButton>
            <RowButton
              label={t("friends.declineNamed", { name })}
              onClick={() => void busy(actions.decline)()}
              disabled={isBusy}
              className="hover:text-nx-dnd"
            >
              <X className="h-4 w-4" />
            </RowButton>
          </>
        )}
        {friend.status === "outgoing" && (
          <RowButton
            label={t("friends.cancelNamed", { name })}
            onClick={() => void busy(actions.remove)()}
            disabled={isBusy}
            className="hover:text-nx-dnd"
          >
            <X className="h-4 w-4" />
          </RowButton>
        )}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={isBusy}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  aria-label={t("friends.moreNamed", { name })}
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("friends.moreNamed", { name })}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            {friend.status === "friend" && (
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("remove")}>
                {t("friends.remove")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("block")}>
              {t("ignore.ignore")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(open) => setConfirm(open ? "remove" : null)}
        title={t("friends.removeConfirmTitle", { name })}
        description={t("friends.removeConfirmDescription")}
        confirmLabel={t("friends.remove")}
        onConfirm={() => void busy(actions.remove)()}
      />
      <ConfirmDialog
        open={confirm === "block"}
        onOpenChange={(open) => setConfirm(open ? "block" : null)}
        title={t("ignore.confirmTitle", { name })}
        description={t("ignore.confirmDescription")}
        confirmLabel={t("ignore.ignore")}
        onConfirm={() => void busy(actions.block)()}
      />
    </div>
  )
}

/** Discord's friends page on Home: friends by presence, pending requests and "Add friend". */
export function FriendsView({ onOpenNavigation }: { onOpenNavigation: () => void }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const friends = useFriends()
  const actions = useFriendActions()
  const [chosenTab, setChosenTab] = useState<FriendsTab | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)

  const accepted = friends.filter((friend) => friend.status === "friend")
  const pending = friends.filter((friend) => friend.status !== "friend")
  const incomingCount = pending.filter((friend) => friend.status === "incoming").length
  const presence = usePresence(
    client,
    accepted.map((friend) => friend.userId),
  )
  const presenceOf = (friend: Friend): UserPresence => presence[friend.userId] ?? "unknown"
  // Without presence from the server, nobody would ever be "online".
  const presenceKnown = accepted.some((friend) => presenceOf(friend) !== "unknown")
  const tabs: FriendsTab[] = presenceKnown ? ["online", "all", "pending"] : ["all", "pending"]
  const tab = chosenTab && tabs.includes(chosenTab) ? chosenTab : incomingCount > 0 ? "pending" : tabs[0]

  const shown =
    tab === "pending"
      ? [...pending].sort((a, b) => (a.status === b.status ? 0 : a.status === "incoming" ? -1 : 1))
      : tab === "online"
        ? accepted.filter((friend) => presenceOf(friend) === "online" || presenceOf(friend) === "unavailable")
        : accepted

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <header className="z-10 flex h-12 shrink-0 items-center gap-2 overflow-x-auto px-2 shadow-[0_1px_0_rgba(4,4,5,0.2),0_1.5px_0_rgba(6,6,7,0.05),0_2px_0_rgba(4,4,5,0.05)] sm:px-4">
        <button
          onClick={onOpenNavigation}
          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
          aria-label={t("nav.open")}
        >
          <Menu className="h-5 w-5" />
        </button>
        <Users className="h-6 w-6 shrink-0 text-muted-foreground" />
        <h3 className="text-base font-semibold text-foreground">{t("friends.title")}</h3>
        <div className="mx-2 h-6 w-px shrink-0 bg-border" />
        <div className="flex items-center gap-1" role="tablist" aria-label={t("friends.tabs")}>
          {tabs.map((entry) => (
            <button
              key={entry}
              role="tab"
              aria-selected={tab === entry}
              onClick={() => setChosenTab(entry)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 text-[15px] font-medium transition-colors",
                tab === entry ? "bg-nx-active text-foreground" : "text-muted-foreground hover:bg-nx-hover hover:text-foreground",
              )}
            >
              {t(TAB_LABELS[entry])}
              {entry === "pending" && incomingCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-nx-dnd px-1 text-[11px] font-bold text-white">
                  {incomingCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => setIsAddOpen(true)}
          className="ml-1 shrink-0 rounded bg-nx-online px-2 py-0.5 text-[15px] font-medium text-white hover:bg-nx-online/90"
        >
          {t("friends.add")}
        </button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <h4 className="px-6 pt-4 pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t(TAB_COUNTS[tab], { count: shown.length })}
        </h4>
        {shown.length > 0 ? (
          <div className="flex flex-col px-2" role="list">
            {shown.map((friend) => (
              <div key={friend.userId} role="listitem">
                <FriendRow friend={friend} presence={presenceOf(friend)} />
              </div>
            ))}
          </div>
        ) : (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">{t(TAB_EMPTY[tab])}</p>
        )}
      </ScrollArea>

      <UserPickerDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        title={t("friends.add")}
        description={t("friends.addDescription")}
        submitLabel={t("friends.sendRequest")}
        excludeUserIds={friends.filter((friend) => friend.status !== "incoming").map((friend) => friend.userId)}
        onSubmit={async (users) => {
          if (await actions.request(users.map((user) => user.userId))) setIsAddOpen(false)
        }}
      />
    </div>
  )
}
