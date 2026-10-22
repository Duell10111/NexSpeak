"use client"

import { useRef, useState, type ChangeEvent, type FormEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useOwnPresence, useOwnProfile, useOwnStatus } from "@/hooks/useOwnProfile"
import { useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_STATUS_LENGTH,
  STATUS_EXPIRY_OPTIONS,
  setOwnStatus,
  type StatusExpiry,
  OWN_PRESENCE_OPTIONS,
  setOwnAvatar,
  setOwnDisplayName,
  setOwnPresence,
  type OwnPresence,
} from "@nexspeak/core/matrix/profile"
import type { MessageKey } from "@nexspeak/i18n"

const MAX_AVATAR_BYTES = 10 * 1024 * 1024

export const PRESENCE_DOT: Record<OwnPresence, string> = {
  online: "bg-nx-online",
  dnd: "bg-destructive",
  unavailable: "bg-nx-idle",
  offline: "bg-nx-offline",
}

export const PRESENCE_LABEL: Record<OwnPresence, MessageKey> = {
  online: "presence.online",
  dnd: "presence.dnd",
  unavailable: "presence.away",
  offline: "presence.invisible",
}

export const PRESENCE_HINT: Record<OwnPresence, MessageKey> = {
  online: "presence.onlineHint",
  dnd: "presence.dndHint",
  unavailable: "presence.awayHint",
  offline: "presence.invisibleHint",
}

/** Presence choices, shared by the settings and the user panel menu. */
export function PresencePicker({ onPicked }: { onPicked?: () => void }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const current = useOwnPresence()

  const pick = (presence: OwnPresence) => {
    onPicked?.()
    if (!client || presence === current) return
    setOwnPresence(client, presence).catch((error: unknown) => {
      toast.error(describeMatrixError(error, t("profile.presenceFailed")))
    })
  }

  return (
    <div className="flex flex-col gap-0.5" role="radiogroup" aria-label={t("profile.presence")}>
      {OWN_PRESENCE_OPTIONS.map((presence) => (
        <button
          key={presence}
          role="radio"
          aria-checked={current === presence}
          onClick={() => pick(presence)}
          className={cn(
            "flex items-start gap-2.5 rounded px-2 py-1.5 text-left hover:bg-muted",
            current === presence && "bg-muted",
          )}
        >
          <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", PRESENCE_DOT[presence])} />
          <span className="min-w-0">
            <span className="block text-sm text-foreground">{t(PRESENCE_LABEL[presence])}</span>
            <span className="block text-xs text-muted-foreground">{t(PRESENCE_HINT[presence])}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export function CustomStatusEditor() {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const status = useOwnStatus(client)
  const [draft, setDraft] = useState<string | null>(null)
  const [expiry, setExpiry] = useState<StatusExpiry>("never")
  const [saving, setSaving] = useState(false)

  const save = async (message: string) => {
    if (!client || saving) return
    setSaving(true)
    try {
      await setOwnStatus(client, message, expiry)
      setDraft(null)
      toast.success(t("profile.saved"))
    } catch (error) {
      toast.error(describeMatrixError(error, t("profile.presenceFailed")))
    } finally { setSaving(false) }
  }

  return (
    <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void save(draft ?? status) }}>
      <Label htmlFor="custom-status">{t("profile.customStatus")}</Label>
      <Input id="custom-status" value={draft ?? status} maxLength={MAX_STATUS_LENGTH}
        placeholder={t("profile.customStatusPlaceholder")} disabled={saving || !client}
        onChange={(event) => setDraft(event.target.value)} />
      <p className="text-xs text-muted-foreground">{t("profile.customStatusHint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="status-expiry">{t("profile.clearAfter")}</Label>
        <select id="status-expiry" value={expiry} disabled={saving}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          onChange={(event) => setExpiry(event.target.value as StatusExpiry)}>
          {STATUS_EXPIRY_OPTIONS.map((option) => <option key={option} value={option}>{t(`profile.expiry.${option}`)}</option>)}
        </select>
        <Button type="submit" size="sm" disabled={saving || !client || !(draft ?? status).trim()}>{t("profile.saveStatus")}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving || !status}
          onClick={() => void save("")}>{t("profile.clearStatus")}</Button>
      </div>
    </form>
  )
}

export function ProfilePanel() {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const profile = useOwnProfile(client)
  const [draftName, setDraftName] = useState<string | null>(null)
  const [isSavingName, setIsSavingName] = useState(false)
  const [isSavingAvatar, setIsSavingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const name = draftName ?? profile?.name ?? ""
  const isNameChanged = draftName !== null && draftName.trim() !== "" && draftName.trim() !== profile?.name

  const saveName = async (event: FormEvent) => {
    event.preventDefault()
    if (!client || !isNameChanged || draftName === null) return
    setIsSavingName(true)
    try {
      await setOwnDisplayName(client, draftName)
      setDraftName(null)
      toast.success(t("profile.saved"))
    } catch (error) {
      toast.error(describeMatrixError(error, t("profile.saveFailed")))
    } finally {
      setIsSavingName(false)
    }
  }

  const changeAvatar = async (file: File | null) => {
    if (!client) return
    if (file && !file.type.startsWith("image/")) {
      toast.error(t("profile.avatarNotImage"))
      return
    }
    if (file && file.size > MAX_AVATAR_BYTES) {
      toast.error(t("profile.avatarTooLarge"))
      return
    }
    setIsSavingAvatar(true)
    try {
      await setOwnAvatar(client, file)
    } catch (error) {
      toast.error(describeMatrixError(error, t("profile.saveFailed")))
    } finally {
      setIsSavingAvatar(false)
    }
  }

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ""
    if (file) void changeAvatar(file)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <MatrixAvatar mxcUrl={profile?.avatarMxc} name={profile?.name || "?"} size={72} className="text-2xl" />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isSavingAvatar}>
            {isSavingAvatar && <Spinner className="mr-2 h-4 w-4" />}
            {t("profile.changeAvatar")}
          </Button>
          {profile?.avatarMxc && (
            <Button size="sm" variant="ghost" onClick={() => void changeAvatar(null)} disabled={isSavingAvatar}>
              {t("profile.removeAvatar")}
            </Button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </div>
      </div>

      <form onSubmit={(event) => void saveName(event)} className="space-y-2">
        <Label htmlFor="display-name">{t("profile.displayName")}</Label>
        <div className="flex gap-2">
          <Input
            id="display-name"
            value={name}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            onChange={(event) => setDraftName(event.target.value)}
            disabled={!profile || isSavingName}
          />
          <Button type="submit" disabled={!isNameChanged || isSavingName}>
            {isSavingName && <Spinner className="mr-2 h-4 w-4" />}
            {t("common.save")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("profile.displayNameHint")}</p>
      </form>

      <CustomStatusEditor />

      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">{t("profile.presence")}</p>
        <PresencePicker />
        <p className="text-xs text-muted-foreground">{t("profile.presenceHint")}</p>
      </div>
    </div>
  )
}
