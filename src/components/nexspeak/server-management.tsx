"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { toast } from "sonner"
import {
  ChevronDown,
  FolderPlus,
  LogOut,
  MoveDown,
  MoveUp,
  Pencil,
  PlusCircle,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { UserPickerDialog } from "@/components/nexspeak/user-picker-dialog"
import {
  ChannelSettingsDialog,
  ConfirmDialog,
  CreateCategoryDialog,
  CreateChannelDialog,
  ServerSettingsDialog,
} from "@/components/nexspeak/server-dialogs"
import { useNavigation } from "@/components/nexspeak/navigation-context"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { t as translate } from "@/lib/i18n"
import { describeMatrixError } from "@/lib/matrix/errors"
import { inviteToChannel, inviteToSpace, joinSpaceChannels, type UserSearchResult } from "@/lib/matrix/direct"
import {
  canEditRoom,
  canManageChannels,
  deleteCategory,
  deleteChannel,
  findParentId,
  leaveServer,
  moveChild,
} from "@/lib/matrix/server"
import { DIRECT_MESSAGES_ID, type MatrixRoom } from "@/lib/matrix/types"

export interface ManagedSection {
  id: string
  name?: string
  isCategory: boolean
  rooms: MatrixRoom[]
}

interface ServerManagementValue {
  serverId: string
  canManage: boolean
  canEdit: (roomId: string) => boolean
  canInviteTo: (roomId: string) => boolean
  createChannel: (parentId?: string) => void
  editRoom: (roomId: string) => void
  addMembers: (roomId: string) => void
  deleteRoom: (roomId: string) => void
  /** Move a channel before `beforeRoomId` (null: end) of a section. */
  moveChannel: (roomId: string, toSectionId: string, beforeRoomId: string | null) => void
  moveCategory: (categoryId: string, beforeCategoryId: string | null) => void
  /** Up (-1) or down (+1) within its section, for menus and keyboards. */
  moveChannelBy: (roomId: string, delta: -1 | 1) => void
  moveCategoryBy: (categoryId: string, delta: -1 | 1) => void
}

const ServerManagementContext = createContext<ServerManagementValue | null>(null)

/** Null on the DM home screen. */
export function useServerManagement(): ServerManagementValue | null {
  return useContext(ServerManagementContext)
}

// Per session: which server structures we already joined the channels of.
const syncedStructures = new Map<string, string>()

/**
 * New channels and categories show up for everyone, like on Discord: when the structure of
 * the open server changes, join what we may join. Runs only on changes, never periodically.
 */
function useJoinNewChannels(serverId: string, structureKey: string) {
  const { client } = useMatrixClient()
  useEffect(() => {
    if (!client || syncedStructures.get(serverId) === structureKey) return
    const timer = setTimeout(() => {
      syncedStructures.set(serverId, structureKey)
      joinSpaceChannels(client, serverId, { skipLeft: true }).catch((error: unknown) =>
        console.info("Could not sync server channels:", error),
      )
    }, 1_000)
    return () => clearTimeout(timer)
  }, [client, serverId, structureKey])
}

function runAction(action: Promise<unknown>, fallback: string) {
  action.catch((error: unknown) => toast.error(describeMatrixError(error, fallback)))
}

export function ServerManagementProvider({
  serverId,
  sections,
  structureKey,
  children,
}: {
  serverId: string
  sections: ManagedSection[]
  structureKey: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const { openRoom } = useNavigation()
  const [createIn, setCreateIn] = useState<string | null>(null)
  const [editingId, setEditingId] = useState("")
  const [addingTo, setAddingTo] = useState("")
  const [deletingId, setDeletingId] = useState("")
  useJoinNewChannels(serverId, structureKey)

  const categories = sections.filter((section) => section.isCategory)
  const isCategory = (roomId: string) => categories.some((category) => category.id === roomId)
  const sectionOf = (roomId: string) => sections.find((section) => section.rooms.some((room) => room.id === roomId))
  const ownId = client?.getUserId() ?? ""
  const canManage = Boolean(client && canManageChannels(client, serverId))

  const moveChannel = (roomId: string, toSectionId: string, beforeRoomId: string | null) => {
    if (!client) return
    const fromParentId = findParentId(client, serverId, roomId)
    if (!fromParentId) return
    runAction(moveChild(client, { roomId, fromParentId, toParentId: toSectionId, beforeRoomId }), t("manage.moveFailed"))
  }

  const moveCategory = (categoryId: string, beforeCategoryId: string | null) => {
    if (!client) return
    runAction(
      moveChild(client, { roomId: categoryId, fromParentId: serverId, toParentId: serverId, beforeRoomId: beforeCategoryId }),
      t("manage.moveFailed"),
    )
  }

  const value: ServerManagementValue = {
    serverId,
    canManage,
    canEdit: (roomId) => Boolean(client && canEditRoom(client, roomId)),
    canInviteTo: (roomId) => Boolean(client?.getRoom(roomId)?.canInvite(ownId)),
    createChannel: (parentId) => setCreateIn(parentId ?? serverId),
    editRoom: setEditingId,
    addMembers: setAddingTo,
    deleteRoom: setDeletingId,
    moveChannel,
    moveCategory,
    moveChannelBy: (roomId, delta) => {
      const section = sectionOf(roomId)
      if (!section) return
      const index = section.rooms.findIndex((room) => room.id === roomId)
      const target = index + delta
      if (target < 0 || target >= section.rooms.length) return
      moveChannel(roomId, section.id, delta < 0 ? section.rooms[target].id : (section.rooms[target + 1]?.id ?? null))
    },
    moveCategoryBy: (categoryId, delta) => {
      const index = categories.findIndex((category) => category.id === categoryId)
      const target = index + delta
      if (index === -1 || target < 0 || target >= categories.length) return
      moveCategory(categoryId, delta < 0 ? categories[target].id : (categories[target + 1]?.id ?? null))
    },
  }

  const confirmDelete = () => {
    const roomId = deletingId
    setDeletingId("")
    setEditingId("")
    if (!client || !roomId) return
    const reason = translate("manage.deletedReason")
    const action = isCategory(roomId)
      ? deleteCategory(client, { serverId, categoryId: roomId, reason })
      : (async () => {
          const parentId = findParentId(client, serverId, roomId) ?? serverId
          await deleteChannel(client, { parentId, roomId, reason })
        })()
    runAction(
      action.then(() => toast.success(t("manage.deleted"))),
      t("manage.deleteFailed"),
    )
  }

  const channelRoom = addingTo ? client?.getRoom(addingTo) : null
  const channelMemberIds = (channelRoom?.getMembers() ?? [])
    .filter((member) => member.membership === "join" || member.membership === "invite")
    .map((member) => member.userId)
  const serverMembers: UserSearchResult[] = (client?.getRoom(serverId)?.getJoinedMembers() ?? [])
    .filter((member) => member.userId !== ownId)
    .map((member) => ({ userId: member.userId, displayName: member.name, avatarMxc: member.getMxcAvatarUrl() || undefined }))

  const deletingName = deletingId ? (client?.getRoom(deletingId)?.name ?? "") : ""

  return (
    <ServerManagementContext.Provider value={value}>
      {children}
      <CreateChannelDialog
        open={createIn !== null}
        onOpenChange={(open) => !open && setCreateIn(null)}
        serverId={serverId}
        categories={categories.map((category) => ({ id: category.id, name: category.name ?? "" }))}
        initialParentId={createIn ?? serverId}
        onCreated={(roomId) => {
          setCreateIn(null)
          openRoom(roomId, serverId)
        }}
      />
      <ChannelSettingsDialog
        roomId={editingId}
        serverId={serverId}
        isCategory={isCategory(editingId)}
        onOpenChange={(open) => !open && setEditingId("")}
        onDelete={() => setDeletingId(editingId)}
      />
      <UserPickerDialog
        open={Boolean(addingTo)}
        onOpenChange={(open) => !open && setAddingTo("")}
        title={t("manage.addMembersTitle", { name: channelRoom?.name ?? "" })}
        description={t("manage.addMembersDescription")}
        submitLabel={t("manage.addMembersSubmit")}
        excludeUserIds={channelMemberIds}
        suggestions={serverMembers}
        onSubmit={async (users) => {
          if (!client || !addingTo) return
          let failed = 0
          for (const user of users) {
            try {
              await inviteToChannel(client, serverId, addingTo, user.userId)
            } catch (error) {
              failed += 1
              toast.error(t("server.inviteFailedFor", { name: user.displayName, reason: describeMatrixError(error) }))
            }
          }
          if (failed < users.length) toast.success(t("manage.membersAdded", { count: users.length - failed }))
          if (failed === 0) setAddingTo("")
        }}
      />
      <ConfirmDialog
        open={Boolean(deletingId)}
        onOpenChange={(open) => !open && setDeletingId("")}
        title={isCategory(deletingId) ? t("manage.deleteCategoryTitle", { name: deletingName }) : t("manage.deleteChannelTitle", { name: deletingName })}
        description={isCategory(deletingId) ? t("manage.deleteCategoryDescription") : t("manage.deleteChannelDescription")}
        confirmLabel={t("common.delete")}
        onConfirm={confirmDelete}
      />
    </ServerManagementContext.Provider>
  )
}

/** Discord's server name dropdown at the top of the channel list. */
export function ServerHeaderMenu({ title }: { title: string }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const { openRoom } = useNavigation()
  const management = useServerManagement()
  const [dialog, setDialog] = useState<"invite" | "settings" | "category" | "leave" | null>(null)
  if (!management) return null
  const { serverId, canManage } = management
  const canInvite = management.canInviteTo(serverId)
  const memberIds = client?.getRoom(serverId)?.getJoinedMembers().map((member) => member.userId) ?? []

  const leave = () => {
    setDialog(null)
    if (!client) return
    runAction(
      leaveServer(client, serverId).then(() => openRoom("", DIRECT_MESSAGES_ID)),
      t("manage.leaveFailed"),
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="-mx-2 flex h-9 min-w-0 flex-1 items-center gap-1 rounded px-2 text-left hover:bg-nx-hover data-[state=open]:bg-nx-hover"
            aria-label={t("manage.serverMenu")}
          >
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{title}</h2>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {canInvite && (
            <DropdownMenuItem onSelect={() => setDialog("invite")}>
              <UserPlus className="h-4 w-4" />
              {t("server.invite")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setDialog("settings")}>
            <Settings className="h-4 w-4" />
            {t("manage.serverSettings")}
          </DropdownMenuItem>
          {canManage && (
            <>
              <DropdownMenuItem onSelect={() => management.createChannel()}>
                <PlusCircle className="h-4 w-4" />
                {t("manage.createChannel")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("category")}>
                <FolderPlus className="h-4 w-4" />
                {t("manage.createCategory")}
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("leave")}>
            <LogOut className="h-4 w-4" />
            {t("manage.leaveServer")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <UserPickerDialog
        open={dialog === "invite"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("server.inviteTitle", { name: title })}
        description={t("server.inviteDescription")}
        submitLabel={t("server.inviteSubmit")}
        excludeUserIds={memberIds}
        onSubmit={async (users) => {
          if (!client) return
          const failed: string[] = []
          for (const user of users) {
            try {
              await inviteToSpace(client, serverId, user.userId)
            } catch (error) {
              failed.push(user.displayName)
              toast.error(t("server.inviteFailedFor", { name: user.displayName, reason: describeMatrixError(error) }))
            }
          }
          const invited = users.length - failed.length
          if (invited > 0) {
            toast.success(
              invited === 1 && failed.length === 0
                ? t("server.invitedOne", { name: users[0].displayName })
                : t("server.invitedMany", { count: invited }),
            )
          }
          if (failed.length === 0) setDialog(null)
        }}
      />
      <ServerSettingsDialog serverId={serverId} open={dialog === "settings"} onOpenChange={(open) => !open && setDialog(null)} />
      <CreateCategoryDialog serverId={serverId} open={dialog === "category"} onOpenChange={(open) => !open && setDialog(null)} />
      <ConfirmDialog
        open={dialog === "leave"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("manage.leaveTitle", { name: title })}
        description={t("manage.leaveDescription")}
        confirmLabel={t("manage.leaveServer")}
        onConfirm={leave}
      />
    </>
  )
}

/** Right-click menu of a channel (long press on touch screens). */
export function ChannelContextMenu({
  room,
  sections,
  children,
}: {
  room: MatrixRoom
  sections: ManagedSection[]
  children: ReactNode
}) {
  const { t } = useTranslation()
  const management = useServerManagement()
  if (!management) return <>{children}</>
  const canEdit = management.canEdit(room.id)
  const canInvite = management.canInviteTo(room.id)
  const { canManage } = management
  if (!canEdit && !canInvite && !canManage) return <>{children}</>
  const currentSection = sections.find((section) => section.rooms.some((entry) => entry.id === room.id))

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {canEdit && (
          <ContextMenuItem onSelect={() => management.editRoom(room.id)}>
            <Pencil className="h-4 w-4" />
            {t("manage.editChannel")}
          </ContextMenuItem>
        )}
        {canInvite && (
          <ContextMenuItem onSelect={() => management.addMembers(room.id)}>
            <UserPlus className="h-4 w-4" />
            {t("manage.addMembers")}
          </ContextMenuItem>
        )}
        {canManage && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => management.moveChannelBy(room.id, -1)}>
              <MoveUp className="h-4 w-4" />
              {t("manage.moveUp")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => management.moveChannelBy(room.id, 1)}>
              <MoveDown className="h-4 w-4" />
              {t("manage.moveDown")}
            </ContextMenuItem>
            {sections.length > 1 && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>{t("manage.moveTo")}</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-48">
                  {sections
                    .filter((section) => section.id !== currentSection?.id)
                    .map((section) => (
                      <ContextMenuItem key={section.id} onSelect={() => management.moveChannel(room.id, section.id, null)}>
                        {section.isCategory ? section.name : t("manage.noCategory")}
                      </ContextMenuItem>
                    ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
          </>
        )}
        {canManage && canEdit && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => management.deleteRoom(room.id)}>
              <Trash2 className="h-4 w-4" />
              {t("manage.deleteChannel")}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Right-click menu of a category header. */
export function CategoryContextMenu({ categoryId, children }: { categoryId: string; children: ReactNode }) {
  const { t } = useTranslation()
  const management = useServerManagement()
  if (!management?.canManage) return <>{children}</>
  const canEdit = management.canEdit(categoryId)

  return (
    <ContextMenu>
      {/* A plain element as trigger: the header component doesn't forward the menu's events. */}
      <ContextMenuTrigger asChild>
        <div>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => management.createChannel(categoryId)}>
          <PlusCircle className="h-4 w-4" />
          {t("manage.createChannel")}
        </ContextMenuItem>
        {canEdit && (
          <ContextMenuItem onSelect={() => management.editRoom(categoryId)}>
            <Pencil className="h-4 w-4" />
            {t("manage.editCategory")}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => management.moveCategoryBy(categoryId, -1)}>
          <MoveUp className="h-4 w-4" />
          {t("manage.moveUp")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => management.moveCategoryBy(categoryId, 1)}>
          <MoveDown className="h-4 w-4" />
          {t("manage.moveDown")}
        </ContextMenuItem>
        {canEdit && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => management.deleteRoom(categoryId)}>
              <Trash2 className="h-4 w-4" />
              {t("manage.deleteCategory")}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
