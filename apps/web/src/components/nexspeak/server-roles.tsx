"use client"

import { useState } from "react"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, Check, ChevronDown, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { canManageRoles, readMemberRoleIds, readServerRoles, saveServerRoles, setMemberRoles } from "@nexspeak/core/matrix/server"
import { MAX_ROLE_NAME_LENGTH, planRoleLevels, ROLE_COLORS, type ServerRoleInfo } from "@nexspeak/core/matrix/roles"

type Translate = ReturnType<typeof useTranslation>["t"]

/** Built-in roles are translated, custom ones carry their own name. */
export function roleLabel(role: ServerRoleInfo, t: Translate): string {
  return role.builtIn ? t(`role.${role.id as "admin" | "moderator" | "member"}`) : role.name
}

export function RoleDot({ color, className }: { color?: string; className?: string }) {
  return (
    <span
      className={cn("inline-block h-3 w-3 shrink-0 rounded-full border border-border", className)}
      style={color ? { backgroundColor: color, borderColor: color } : undefined}
      aria-hidden
    />
  )
}

/** Choose someone's roles; each change is saved right away. */
export function RolePicker({ serverId, userId, name, className }: { serverId: string; userId: string; name: string; className?: string }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const [isSaving, setIsSaving] = useState(false)
  if (!client) return null
  const space = client.getRoom(serverId)
  const ownId = client.getUserId() ?? ""
  const ownLevel = space?.getMember(ownId)?.powerLevel ?? 0
  const roles = readServerRoles(client, serverId)
  const assigned = readMemberRoleIds(client, serverId, userId)
  // Like Discord: only people below your own role can be changed.
  const editable = canManageRoles(client, serverId) && userId !== ownId && (space?.getMember(userId)?.powerLevel ?? 0) < ownLevel
  const shown = roles.filter((role) => assigned.includes(role.id))

  const toggle = async (roleId: string, checked: boolean) => {
    setIsSaving(true)
    try {
      const { failed } = await setMemberRoles(client, serverId, userId, checked ? [...assigned, roleId] : assigned.filter((id) => id !== roleId))
      if (failed) toast.warning(t("manage.rolesSavedPartial", { failed }))
      else toast.success(t("manage.rolesChanged", { name }))
    } catch (error) {
      toast.error(describeMatrixError(error, t("manage.roleFailed")))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 w-36 justify-between font-normal", className)}
          disabled={!editable || isSaving}
          aria-label={t("manage.roleOf", { name })}
        >
          <span className="truncate">{shown.length ? shown.map((role) => roleLabel(role, t)).join(", ") : t("role.member")}</span>
          {isSaving ? <Spinner className="h-4 w-4" /> : <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {roles
          .filter((role) => role.id !== "member")
          .map((role) => (
            <DropdownMenuCheckboxItem
              key={role.id}
              checked={assigned.includes(role.id)}
              disabled={role.level > ownLevel || isSaving}
              onCheckedChange={(checked) => void toggle(role.id, checked)}
              // Stay open to tick several roles in a row.
              onSelect={(event) => event.preventDefault()}
            >
              <RoleDot color={role.color} className="mr-2" />
              {roleLabel(role, t)}
            </DropdownMenuCheckboxItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type DraftRole = ServerRoleInfo & { savedLevel?: number }

function toRole(role: DraftRole): ServerRoleInfo {
  return { id: role.id, name: role.name.trim(), level: role.level, color: role.color, hoist: role.hoist, builtIn: role.builtIn }
}

function ColorPicker({ color, label, disabled, onChange }: { color?: string; label: string; disabled: boolean; onChange: (color?: string) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const pick = (next?: string) => {
    onChange(next)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={disabled} aria-label={label}>
          <RoleDot color={color} className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <div className="grid grid-cols-6 gap-1">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border"
            aria-label={t("manage.noColor")}
            onClick={() => pick(undefined)}
          >
            {!color && <Check className="h-4 w-4" />}
          </button>
          {ROLE_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: swatch }}
              aria-label={swatch}
              onClick={() => pick(swatch)}
            >
              {color === swatch && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Levels for the draft order; existing roles keep theirs where possible. */
function withLevels(draft: DraftRole[]): DraftRole[] | null {
  const levels = planRoleLevels(draft.map((role) => ({ id: role.id, level: role.savedLevel })))
  return levels && draft.map((role) => (role.builtIn ? role : { ...role, level: levels.get(role.id)! }))
}

/** Server settings → Roles: create, rename, color, group, reorder and delete roles. */
export function RolesTab({ serverId }: { serverId: string }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const saved = client ? readServerRoles(client, serverId) : []
  const [draft, setDraft] = useState<DraftRole[]>(() => saved.map((role) => ({ ...role, savedLevel: role.builtIn ? undefined : role.level })))
  const [isSaving, setIsSaving] = useState(false)
  const editable = Boolean(client && canManageRoles(client, serverId))
  const planned = withLevels(draft)
  const isDirty = JSON.stringify(planned?.map(toRole)) !== JSON.stringify(saved.map(toRole))
  const valid = Boolean(planned) && draft.every((role) => role.builtIn || role.name.trim())

  const update = (id: string, changes: Partial<DraftRole>) => setDraft(draft.map((role) => (role.id === id ? { ...role, ...changes } : role)))
  const move = (index: number, delta: number) => {
    const next = [...draft]
    const [role] = next.splice(index, 1)
    next.splice(index + delta, 0, role)
    setDraft(next)
  }
  const create = () => {
    const role: DraftRole = { id: `r${Date.now().toString(36)}`, name: t("manage.newRoleName"), level: 0, hoist: false, builtIn: false }
    // Like Discord: new roles start right above Member.
    setDraft([...draft.slice(0, -1), role, draft[draft.length - 1]])
  }
  const canCreate = Boolean(withLevels([...draft.slice(0, -1), { id: "new", name: "", level: 0, hoist: false, builtIn: false }, draft[draft.length - 1]]))

  const save = async () => {
    if (!client || !planned) return
    setIsSaving(true)
    try {
      const { failed } = await saveServerRoles(client, serverId, planned.map(toRole))
      setDraft(planned.map((role) => ({ ...role, savedLevel: role.builtIn ? undefined : role.level })))
      if (failed) toast.warning(t("manage.rolesSavedPartial", { failed }))
      else toast.success(t("manage.saved"))
    } catch (error) {
      toast.error(describeMatrixError(error, t("manage.saveFailed")))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("manage.rolesDescription")}</p>
      <ul className="space-y-2" aria-label={t("manage.roles")}>
        {(planned ?? draft).map((role, index) => {
          const label = roleLabel(role, t) || t("manage.roleName")
          return (
            <li key={role.id} className="flex items-center gap-2 rounded-md border border-border p-2">
              <ColorPicker
                color={role.color}
                label={t("manage.roleColor", { name: label })}
                disabled={!editable}
                onChange={(color) => update(role.id, { color })}
              />
              <div className="min-w-0 flex-1">
                {role.builtIn ? (
                  <p className="truncate text-sm font-medium">{label}</p>
                ) : (
                  <Input
                    className="h-8"
                    value={role.name}
                    maxLength={MAX_ROLE_NAME_LENGTH}
                    disabled={!editable}
                    aria-label={t("manage.roleName")}
                    onChange={(event) => update(role.id, { name: event.target.value })}
                  />
                )}
                <p className="text-xs text-muted-foreground">{t("manage.roleLevel", { level: role.level })}</p>
              </div>
              <Switch
                checked={role.hoist}
                disabled={!editable}
                aria-label={`${t("manage.roleHoist")}: ${label}`}
                title={t("manage.roleHoist")}
                onCheckedChange={(hoist) => update(role.id, { hoist })}
              />
              {!role.builtIn && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={!editable || index <= 1}
                    aria-label={t("manage.moveRoleUp", { name: label })}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={!editable || index >= draft.length - 2}
                    aria-label={t("manage.moveRoleDown", { name: label })}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    disabled={!editable}
                    aria-label={t("manage.deleteRole", { name: label })}
                    onClick={() => setDraft(draft.filter((candidate) => candidate.id !== role.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {!planned && <p className="text-xs text-destructive">{t("manage.tooManyRoles")}</p>}
      {editable ? (
        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={create} disabled={!canCreate || isSaving}>
            <Plus className="mr-2 h-4 w-4" />
            {t("manage.createRole")}
          </Button>
          <Button onClick={() => void save()} disabled={!isDirty || !valid || isSaving}>
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
