"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { createServer } from "@nexspeak/core/matrix/server"

/** Mounted only while open: drafts and object URLs are discarded on close. */
export function CreateServerDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void
  onCreated: (serverId: string, channelId: string) => void
}) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const [name, setName] = useState("")
  const [topic, setTopic] = useState("")
  const [icon, setIcon] = useState<{ file: File; url: string }>()
  const [isCreating, setIsCreating] = useState(false)
  const busy = useRef(false)

  useEffect(() => {
    if (!icon) return
    return () => URL.revokeObjectURL(icon.url)
  }, [icon])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!client || !name.trim() || busy.current) return
    busy.current = true
    setIsCreating(true)
    try {
      const { serverId, channelId } = await createServer(client, { name, topic, icon: icon?.file })
      toast.success(t("createServer.created", { name: name.trim() }))
      onCreated(serverId, channelId)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof RangeError ? t("manage.iconTooLarge") : describeMatrixError(error, t("createServer.failed")))
    } finally {
      busy.current = false
      setIsCreating(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!busy.current) onOpenChange(open) }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md" showCloseButton={!isCreating}>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("createServer.title")}</DialogTitle>
            <DialogDescription>{t("createServer.description")}</DialogDescription>
          </DialogHeader>
          <fieldset disabled={isCreating} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="server-name">{t("manage.name")}</Label>
              <Input id="server-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-description">{t("manage.serverDescription")}</Label>
              <Textarea id="server-description" value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={1024} rows={3} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-icon">{t("manage.icon")}</Label>
              <Input
                id="server-icon"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file && file.size > 10 * 1024 * 1024) {
                    toast.error(t("manage.iconTooLarge"))
                    event.target.value = ""
                    setIcon(undefined)
                    return
                  }
                  setIcon(file ? { file, url: URL.createObjectURL(file) } : undefined)
                }}
              />
              {icon && (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL, released on close
                <img src={icon.url} alt={t("manage.icon")} className="h-20 w-20 rounded-[24px] object-cover" />
              )}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!client || isCreating || !name.trim()}>
              {isCreating && <Spinner className="mr-2 h-4 w-4" />}
              {t("createServer.title")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
