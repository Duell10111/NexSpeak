"use client"

import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { MAX_REPORT_REASON_LENGTH, reportMessage, reportRoom, setIgnored } from "@nexspeak/core/matrix/safety"

export type ReportTarget =
  | { kind: "message"; roomId: string; eventId: string; senderId: string; senderName: string }
  | { kind: "room"; roomId: string; roomName: string }

/**
 * Reports go to the admins of the own homeserver (not to the room's moderators), like in Element.
 * For messages the sender can be ignored in the same step.
 */
export function ReportDialog({ target, onOpenChange }: { target: ReportTarget | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const [reason, setReason] = useState("")
  const [alsoIgnore, setAlsoIgnore] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const isOwnMessage = target?.kind === "message" && target.senderId === client?.getUserId()

  const close = () => {
    onOpenChange(false)
    setReason("")
    setAlsoIgnore(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!client || !target || !reason.trim()) return
    setIsSending(true)
    try {
      if (target.kind === "message") {
        await reportMessage(client, target.roomId, target.eventId, reason)
        if (alsoIgnore && !isOwnMessage) await setIgnored(client, target.senderId, true)
      } else {
        await reportRoom(client, target.roomId, reason)
      }
      toast.success(t("report.sent"))
      close()
    } catch (error) {
      toast.error(describeMatrixError(error, t("report.failed")))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {target?.kind === "room" ? t("report.roomTitle", { name: target.roomName }) : t("report.messageTitle")}
            </DialogTitle>
            <DialogDescription>{t("report.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="report-reason">{t("report.reason")}</Label>
            <Textarea
              id="report-reason"
              value={reason}
              maxLength={MAX_REPORT_REASON_LENGTH}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("report.reasonPlaceholder")}
              required
              autoFocus
            />
          </div>
          {target?.kind === "message" && !isOwnMessage && (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="report-ignore">{t("report.alsoIgnore", { name: target.senderName })}</Label>
              <Switch id="report-ignore" checked={alsoIgnore} onCheckedChange={setAlsoIgnore} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={!reason.trim() || isSending}>
              {isSending && <Spinner className="mr-2 h-4 w-4" />}
              {t("report.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
