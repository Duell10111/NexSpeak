"use client"

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { RoomMemberEvent, RoomStateEvent, type MatrixClient, type RoomMember } from "matrix-js-sdk"
import { toast } from "sonner"
import { ChevronDown, ImagePlus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { RoleDot, roleLabel, RolePicker, RolesTab } from "@/components/nexspeak/server-roles"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useMediaUrl } from "@/hooks/useMediaUrl"
import { useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import {
  banFromServer,
  canEditRoom,
  canManageRoles,
  canRepairServerPermissions,
  createCategory,
  createChannel,
  isPrivateChannel,
  kickFromServer,
  readPermissionParent,
  readRoomDetails,
  readRoomPermissions,
  readServerRoles,
  repairServerPermissions,
  ROLE_LEVELS,
  savePermissions,
  saveRoomDetails,
  setRoomIcon,
  syncPermissionsWithParent,
} from "@nexspeak/core/matrix/server"
import type { ServerRoleInfo } from "@nexspeak/core/matrix/roles"
import {
  PERMISSION_KEYS,
  roleForThreshold,
  samePermissionLevels,
  type PermissionKey,
  type PermissionLevels,
} from "@nexspeak/core/matrix/permissions"

const ICON_TYPES = "image/png,image/jpeg,image/gif,image/webp"

/** Re-render when a room's state changes (name, icon, power levels, members). */
function useRoomStateVersion(client: MatrixClient | null, roomId: string, active: boolean): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!client || !roomId || !active) return
    const onEvent = (event: { getRoomId: () => string | undefined }) => {
      if (event.getRoomId() === roomId) setVersion((value) => value + 1)
    }
    const onMember = (_event: unknown, member: RoomMember) => {
      if (member.roomId === roomId) setVersion((value) => value + 1)
    }
    client.on(RoomStateEvent.Events, onEvent)
    client.on(RoomMemberEvent.Membership, onMember)
    client.on(RoomMemberEvent.PowerLevel, onMember)
    return () => {
      client.removeListener(RoomStateEvent.Events, onEvent)
      client.removeListener(RoomMemberEvent.Membership, onMember)
      client.removeListener(RoomMemberEvent.PowerLevel, onMember)
    }
  }, [client, roomId, active])
  return version
}

/** Server or channel icon: shows the current one, uploads a new one right away. */
function IconPicker({ roomId, name, rounded, disabled }: { roomId: string; name: string; rounded: boolean; disabled: boolean }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isBusy, setIsBusy] = useState(false)
  useRoomStateVersion(client, roomId, true)
  const iconMxc = client?.getRoom(roomId)?.getMxcAvatarUrl() || undefined
  const src = useMediaUrl(client, iconMxc, 160)

  const change = async (file: File | null) => {
    if (!client) return
    setIsBusy(true)
    try {
      await setRoomIcon(client, roomId, file)
    } catch (error) {
      toast.error(error instanceof RangeError ? t("manage.iconTooLarge") : describeMatrixError(error, t("manage.iconFailed")))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          "flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden bg-muted text-2xl font-semibold text-foreground",
          rounded ? "rounded-[24px]" : "rounded-lg",
        )}
      >
        {isBusy ? (
          <Spinner className="h-6 w-6 text-muted-foreground" />
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: URLs cannot go through next/image
          <img src={src} alt={t("manage.icon")} className="h-full w-full object-cover" />
        ) : (
          name.charAt(0).toUpperCase() || "#"
        )}
      </div>
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ICON_TYPES}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null
            event.target.value = ""
            if (file) void change(file)
          }}
        />
        <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={disabled || isBusy}>
          <ImagePlus className="mr-2 h-4 w-4" />
          {t("manage.uploadIcon")}
        </Button>
        {iconMxc && (
          <Button type="button" size="sm" variant="ghost" onClick={() => void change(null)} disabled={disabled || isBusy}>
            <Trash2 className="mr-2 h-4 w-4" />
            {t("manage.removeIcon")}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Name and description (topic) of a server, category or channel. */
function DetailsForm({ roomId, topicLabel, onSaved }: { roomId: string; topicLabel?: string; onSaved?: () => void }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const room = client?.getRoom(roomId)
  const [details, setDetails] = useState(() => readRoomDetails(room))
  const [isSaving, setIsSaving] = useState(false)
  const editable = Boolean(client && canEditRoom(client, roomId))
  const original = readRoomDetails(room)
  const isDirty = details.name.trim() !== original.name || details.topic.trim() !== original.topic

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!client || !details.name.trim()) return
    setIsSaving(true)
    try {
      await saveRoomDetails(client, roomId, details)
      toast.success(t("manage.saved"))
      onSaved?.()
    } catch (error) {
      toast.error(describeMatrixError(error, t("manage.saveFailed")))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`name-${roomId}`}>{t("manage.name")}</Label>
        <Input
          id={`name-${roomId}`}
          value={details.name}
          onChange={(event) => setDetails({ ...details, name: event.target.value })}
          disabled={!editable || isSaving}
          maxLength={100}
          required
        />
      </div>
      {topicLabel && (
        <div className="space-y-2">
          <Label htmlFor={`topic-${roomId}`}>{topicLabel}</Label>
          <Textarea
            id={`topic-${roomId}`}
            value={details.topic}
            onChange={(event) => setDetails({ ...details, topic: event.target.value })}
            disabled={!editable || isSaving}
            maxLength={1024}
            rows={3}
          />
        </div>
      )}
      {editable && (
        <div className="flex justify-end">
          <Button type="submit" disabled={!isDirty || isSaving || !details.name.trim()}>
            {isSaving && <Spinner className="mr-2 h-4 w-4" />}
            {t("manage.saveChanges")}
          </Button>
        </div>
      )}
    </form>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-white hover:bg-destructive/90">
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** A single text field: creating and renaming categories. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  label,
  initialValue = "",
  submitLabel,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label: string
  initialValue?: string
  submitLabel: string
  onSubmit: (value: string) => Promise<boolean>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{label}</DialogDescription>
        </DialogHeader>
        {open && <NameForm label={label} initialValue={initialValue} submitLabel={submitLabel} onSubmit={onSubmit} />}
      </DialogContent>
    </Dialog>
  )
}

function NameForm({
  label,
  initialValue,
  submitLabel,
  onSubmit,
}: {
  label: string
  initialValue: string
  submitLabel: string
  onSubmit: (value: string) => Promise<boolean>
}) {
  const [value, setValue] = useState(initialValue)
  const [isBusy, setIsBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!value.trim()) return
    setIsBusy(true)
    await onSubmit(value.trim())
    setIsBusy(false)
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name-dialog-input">{label}</Label>
        <Input id="name-dialog-input" value={value} onChange={(event) => setValue(event.target.value)} maxLength={100} autoFocus />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isBusy || !value.trim()}>
          {isBusy && <Spinner className="mr-2 h-4 w-4" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}

export function CreateChannelDialog({
  open,
  onOpenChange,
  serverId,
  categories,
  initialParentId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverId: string
  categories: Array<{ id: string; name: string }>
  initialParentId: string
  onCreated: (roomId: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("manage.createChannel")}</DialogTitle>
          <DialogDescription>{t("manage.createChannelDescription")}</DialogDescription>
        </DialogHeader>
        {open && (
          <CreateChannelForm serverId={serverId} categories={categories} initialParentId={initialParentId} onCreated={onCreated} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreateChannelForm({
  serverId,
  categories,
  initialParentId,
  onCreated,
}: {
  serverId: string
  categories: Array<{ id: string; name: string }>
  initialParentId: string
  onCreated: (roomId: string) => void
}) {
  const { t } = useTranslation()
  const { client, isCryptoReady } = useMatrixClient()
  const [name, setName] = useState("")
  const [parentId, setParentId] = useState(initialParentId)
  const [isPrivate, setIsPrivate] = useState(false)
  const [encrypted, setEncrypted] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!client || !name.trim()) return
    setIsBusy(true)
    try {
      const roomId = await createChannel(client, { serverId, parentId, name: name.trim(), isPrivate, encrypted })
      onCreated(roomId)
    } catch (error) {
      toast.error(describeMatrixError(error, t("manage.createChannelFailed")))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="channel-name">{t("manage.channelName")}</Label>
        <Input
          id="channel-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("manage.channelNamePlaceholder")}
          maxLength={100}
          autoFocus
        />
      </div>
      {categories.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="channel-category">{t("manage.category")}</Label>
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger id="channel-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={serverId}>{t("manage.noCategory")}</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <SwitchRow
        id="channel-private"
        label={t("manage.privateChannel")}
        description={t("manage.privateChannelDescription")}
        checked={isPrivate}
        onChange={setIsPrivate}
      />
      <SwitchRow
        id="channel-encrypted"
        label={t("manage.encryptedChannel")}
        description={t("manage.encryptedChannelDescription")}
        checked={encrypted}
        disabled={!isCryptoReady}
        onChange={setEncrypted}
      />
      <DialogFooter>
        <Button type="submit" disabled={isBusy || !name.trim()}>
          {isBusy && <Spinner className="mr-2 h-4 w-4" />}
          {t("manage.createChannel")}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function CreateCategoryDialog({
  open,
  onOpenChange,
  serverId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverId: string
}) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("manage.createCategory")}
      label={t("manage.categoryName")}
      submitLabel={t("manage.createCategory")}
      onSubmit={async (name) => {
        if (!client) return false
        try {
          await createCategory(client, { serverId, name })
          onOpenChange(false)
          return true
        } catch (error) {
          toast.error(describeMatrixError(error, t("manage.createCategoryFailed")))
          return false
        }
      }}
    />
  )
}

const CUSTOM_LEVEL = "custom"

/** One threshold: "from role X upwards". Levels that match no role stay visible as "custom". */
function PermissionSelect({
  permission,
  roles,
  value,
  ownLevel,
  disabled,
  onChange,
}: {
  permission: PermissionKey
  roles: ServerRoleInfo[]
  value: number
  ownLevel: number
  disabled: boolean
  onChange: (level: number) => void
}) {
  const { t } = useTranslation()
  const role = roleForThreshold(value, roles)
  const label = t(`manage.permission.${permission}`)
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="font-normal">{label}</Label>
      <Select
        value={role?.id ?? CUSTOM_LEVEL}
        onValueChange={(id) => {
          const next = roles.find((option) => option.id === id)
          if (next) onChange(next.level)
        }}
        disabled={disabled}
      >
        <SelectTrigger className="h-8 w-40 shrink-0" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!role && (
            <SelectItem value={CUSTOM_LEVEL} disabled>
              {t("manage.permissionCustomLevel", { level: value })}
            </SelectItem>
          )}
          {roles.map((option) => (
            <SelectItem key={option.id} value={option.id} disabled={option.level > ownLevel}>
              <span className="flex items-center gap-2">
                <RoleDot color={option.color} />
                {roleLabel(option, t)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Permissions of the server (defaults), a category or a channel. */
function PermissionsForm({ roomId, serverId, scope }: { roomId: string; serverId: string; scope: "server" | "category" | "channel" }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const room = client?.getRoom(roomId)
  const original = readRoomPermissions(room)
  const [levels, setLevels] = useState<PermissionLevels>(original)
  const [isPrivate, setIsPrivate] = useState(() => isPrivateChannel(room))
  const [showAll, setShowAll] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const editable = Boolean(client && canManageRoles(client, roomId))
  const ownLevel = room?.getMember(client?.getUserId() ?? "")?.powerLevel ?? ROLE_LEVELS.member
  const parent = client ? readPermissionParent(client, serverId, roomId) : null
  const roles = client ? readServerRoles(client, serverId) : []
  const parentName = parent ? (client?.getRoom(parent.roomId)?.name ?? "") : ""
  const isDirty = !samePermissionLevels(levels, original) || (scope === "channel" && isPrivate !== isPrivateChannel(room))
  const update = (changes: Partial<PermissionLevels>) => setLevels({ ...levels, ...changes })
  const mayChange = (key: PermissionKey, level: number) => editable && original[key] <= ownLevel && level <= ownLevel

  const run = async (action: () => Promise<{ followers: number; failed: number }>, next: PermissionLevels) => {
    if (!client) return
    setIsSaving(true)
    try {
      const { followers, failed } = await action()
      setLevels(next)
      if (failed) toast.warning(t("manage.savedPartial", { updated: followers, failed }))
      else toast.success(followers ? t("manage.savedFollowers", { count: followers }) : t("manage.saved"))
    } catch (error) {
      toast.error(describeMatrixError(error, t("manage.saveFailed")))
    } finally {
      setIsSaving(false)
    }
  }
  const save = () =>
    run(() => savePermissions(client!, { serverId, roomId, levels, isPrivate: scope === "channel" ? isPrivate : undefined }), levels)
  const sync = () =>
    run(() => syncPermissionsWithParent(client!, serverId, roomId), readRoomPermissions(client?.getRoom(parent?.roomId ?? "")))

  return (
    <div className="space-y-5">
      {scope === "server" ? (
        <p className="text-xs text-muted-foreground">{t("manage.serverPermissionsDescription")}</p>
      ) : (
        parent && (
          <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {parent.synced ? t("manage.syncedWith", { name: parentName }) : t("manage.customPermissions")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(parent.synced ? "manage.syncedWithDescription" : "manage.customPermissionsDescription", { name: parentName })}
              </p>
            </div>
            {!parent.synced && editable && (
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => void sync()} disabled={isSaving}>
                {t("manage.syncPermissions", { name: parentName })}
              </Button>
            )}
          </div>
        )
      )}
      {scope === "channel" && (
        <SwitchRow
          id="perm-private"
          label={t("manage.privateChannel")}
          description={t("manage.privateChannelDescription")}
          checked={isPrivate}
          disabled={!editable}
          onChange={setIsPrivate}
        />
      )}
      {/* Shortcuts for the most common thresholds; they edit the same values as the list below. */}
      <SwitchRow
        id="perm-write"
        label={t("manage.moderatorsOnlyWrite")}
        description={t("manage.moderatorsOnlyWriteDescription")}
        checked={levels.sendMessages > ROLE_LEVELS.member}
        disabled={!mayChange("sendMessages", ROLE_LEVELS.moderator)}
        onChange={(checked) => update({ sendMessages: checked ? ROLE_LEVELS.moderator : ROLE_LEVELS.member })}
      />
      <SwitchRow
        id="perm-call"
        label={t("manage.everyoneCanCall")}
        description={t("manage.everyoneCanCallDescription")}
        checked={levels.joinCalls <= ROLE_LEVELS.member}
        disabled={!mayChange("joinCalls", ROLE_LEVELS.moderator)}
        onChange={(checked) => update({ joinCalls: checked ? ROLE_LEVELS.member : ROLE_LEVELS.moderator })}
      />
      <div className="space-y-3 border-t border-border pt-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          <ChevronDown className={cn("mr-1 h-4 w-4 transition-transform", !showAll && "-rotate-90")} />
          {t("manage.allPermissions")}
        </Button>
        {showAll && (
          <>
            <p className="text-xs text-muted-foreground">{t("manage.permissionsHint")}</p>
            {PERMISSION_KEYS.map((key) => (
              <PermissionSelect
                key={key}
                permission={key}
                roles={roles}
                value={levels[key]}
                ownLevel={ownLevel}
                disabled={!mayChange(key, levels[key])}
                onChange={(level) => update({ [key]: level })}
              />
            ))}
          </>
        )}
      </div>
      {editable ? (
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={!isDirty || isSaving}>
            {isSaving && <Spinner className="mr-2 h-4 w-4" />}
            {t("manage.saveChanges")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("manage.noPermission")}</p>
      )}
    </div>
  )
}

export function ChannelSettingsDialog({
  roomId,
  serverId,
  isCategory,
  onOpenChange,
  onDelete,
}: {
  /** Empty: closed. */
  roomId: string
  serverId: string
  isCategory: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  useRoomStateVersion(client, roomId, Boolean(roomId))
  const room = roomId ? client?.getRoom(roomId) : null
  const name = room?.name ?? ""
  const canEdit = Boolean(client && roomId && canEditRoom(client, roomId))

  return (
    <Dialog open={Boolean(roomId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isCategory ? t("manage.categorySettings") : t("manage.channelSettings")}</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        {roomId && (
          <Tabs defaultValue="overview" key={roomId}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="overview">{t("manage.overview")}</TabsTrigger>
              <TabsTrigger value="permissions">{t("manage.permissions")}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="space-y-6 pt-2">
              {!isCategory && <IconPicker roomId={roomId} name={name} rounded={false} disabled={!canEdit} />}
              <DetailsForm roomId={roomId} topicLabel={isCategory ? undefined : t("manage.channelTopic")} />
              {canEdit && (
                <div className="border-t border-border pt-4">
                  <Button variant="destructive" className="w-full" onClick={onDelete}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {isCategory ? t("manage.deleteCategory") : t("manage.deleteChannel")}
                  </Button>
                </div>
              )}
            </TabsContent>
            <TabsContent value="permissions" className="pt-2">
              <PermissionsForm roomId={roomId} serverId={serverId} scope={isCategory ? "category" : "channel"} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

function MembersTab({ serverId }: { serverId: string }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  useRoomStateVersion(client, serverId, true)
  const [pending, setPending] = useState<{ userId: string; name: string; action: "kick" | "ban" } | null>(null)
  const room = client?.getRoom(serverId)
  const ownId = client?.getUserId() ?? ""

  useEffect(() => {
    room?.loadMembersIfNeeded().catch((error: unknown) => console.warn("Failed to load server members:", error))
  }, [room])

  if (!client || !room) return null
  const levels = room.currentState.getStateEvents("m.room.power_levels", "")?.getContent() ?? {}
  const ownLevel = room.getMember(ownId)?.powerLevel ?? 0
  const kickLevel = (levels.kick as number | undefined) ?? 50
  const banLevel = (levels.ban as number | undefined) ?? 50
  const members = room
    .getJoinedMembers()
    .sort((a, b) => b.powerLevel - a.powerLevel || a.name.localeCompare(b.name))

  const remove = async () => {
    const target = pending
    setPending(null)
    if (!target) return
    try {
      if (target.action === "kick") {
        await kickFromServer(client, serverId, target.userId)
        toast.success(t("manage.kicked", { name: target.name }))
      } else {
        await banFromServer(client, serverId, target.userId)
        toast.success(t("manage.banned", { name: target.name }))
      }
    } catch (error) {
      toast.error(describeMatrixError(error, t("manage.removeFailed")))
    }
  }

  return (
    <>
      <ScrollArea className="max-h-[50vh]">
        <ul className="space-y-1 pr-3" aria-label={t("members.title")}>
          {members.map((member) => {
            const isSelf = member.userId === ownId
            // Like Discord: only people below your own role can be changed or removed.
            const outranked = member.powerLevel < ownLevel
            return (
              <li key={member.userId} className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-nx-hover">
                <MatrixAvatar mxcUrl={member.getMxcAvatarUrl()} name={member.name} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{member.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.userId}</p>
                </div>
                <RolePicker serverId={serverId} userId={member.userId} name={member.name} />
                {!isSelf && outranked && ownLevel >= kickLevel && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPending({ userId: member.userId, name: member.name, action: "kick" })}
                  >
                    {t("manage.kick")}
                  </Button>
                )}
                {!isSelf && outranked && ownLevel >= banLevel && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setPending({ userId: member.userId, name: member.name, action: "ban" })}
                  >
                    {t("manage.ban")}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </ScrollArea>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.action === "ban" ? t("manage.banTitle", { name: pending.name }) : t("manage.kickTitle", { name: pending?.name ?? "" })}
        description={pending?.action === "ban" ? t("manage.banDescription") : t("manage.kickDescription")}
        confirmLabel={pending?.action === "ban" ? t("manage.ban") : t("manage.kick")}
        onConfirm={() => void remove()}
      />
    </>
  )
}

function RepairPermissions({ isRepairing, onRepair }: { isRepairing: boolean; onRepair: () => void }) {
  const { t } = useTranslation()

  return (
    <div className="space-y-2 border-t pt-4">
      <h3 className="text-sm font-medium">{t("manage.repairPermissions")}</h3>
      <p className="text-sm text-muted-foreground">{t("manage.repairDescription")}</p>
      <Button variant="outline" disabled={isRepairing} onClick={onRepair}>
        {isRepairing && <Spinner className="mr-2 h-4 w-4" />}
        {t(isRepairing ? "manage.repairing" : "manage.repairPermissions")}
      </Button>
    </div>
  )
}

export function ServerSettingsDialog({
  serverId,
  open,
  onOpenChange,
}: {
  serverId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  useRoomStateVersion(client, serverId, open)
  const room = client?.getRoom(serverId)
  const name = room?.name ?? ""
  const canEdit = Boolean(client && canEditRoom(client, serverId))
  const [isRepairing, setIsRepairing] = useState(false)
  const repairing = useRef(false)

  const repair = async () => {
    if (!client || repairing.current) return
    repairing.current = true
    setIsRepairing(true)
    try {
      const { repaired, failed } = await repairServerPermissions(client, serverId)
      if (failed) {
        toast.warning(t("manage.repairPartial", { repaired, failed }))
      } else {
        toast.success(t("manage.repairDone", { count: repaired }))
      }
    } catch (error) {
      toast.error(describeMatrixError(error, t("manage.repairFailed")))
    } finally {
      repairing.current = false
      setIsRepairing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("manage.serverSettings")}</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        {open && (
          <Tabs defaultValue="overview">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">{t("manage.overview")}</TabsTrigger>
              <TabsTrigger value="roles">{t("manage.roles")}</TabsTrigger>
              <TabsTrigger value="permissions">{t("manage.permissions")}</TabsTrigger>
              <TabsTrigger value="members">{t("members.title")}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="space-y-6 pt-2">
              <IconPicker roomId={serverId} name={name} rounded disabled={!canEdit} />
              <DetailsForm roomId={serverId} topicLabel={t("manage.serverDescription")} />
              {client && canRepairServerPermissions(client, serverId) && (
                <RepairPermissions isRepairing={isRepairing} onRepair={() => void repair()} />
              )}
            </TabsContent>
            <TabsContent value="roles" className="pt-2">
              <RolesTab serverId={serverId} />
            </TabsContent>
            <TabsContent value="permissions" className="pt-2">
              <PermissionsForm roomId={serverId} serverId={serverId} scope="server" />
            </TabsContent>
            <TabsContent value="members" className="pt-2">
              <MembersTab serverId={serverId} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
