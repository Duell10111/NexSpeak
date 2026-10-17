"use client"

import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { joinSpaceChannels } from "@nexspeak/core/matrix/direct"

/**
 * Join a room or server by address (#alias:server or !id:server). Also opened, prefilled, for
 * Matrix links to rooms the user is not in yet: the dialog doubles as the confirmation.
 */
export function JoinRoomDialog({
  open,
  onOpenChange,
  onJoined,
  initialAddress = "",
  via,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onJoined: (roomId: string) => void
  initialAddress?: string
  /** Servers that know the room; needed for room ids of other servers. */
  via?: string[]
}) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const [address, setAddress] = useState(initialAddress)
  const [isJoining, setIsJoining] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const target = address.trim()
    if (!client || !target) return

    // #alias:server or a room id (room version 12 ids have no server part).
    if (!/^(#[^:\s]+:\S+|![^:\s]+(:\S+)?)$/.test(target)) {
      toast.error(t("join.invalidAddress"))
      return
    }

    setIsJoining(true)
    try {
      const room = await client.joinRoom(target, { viaServers: target === initialAddress ? via : undefined })
      // Joining a server means joining its channels, like on Discord. The room type may not
      // have synced yet; for an ordinary room the hierarchy is just the room itself.
      await joinSpaceChannels(client, room.roomId).catch((error: unknown) => console.info("No channels joined:", error))
      toast.success(t("join.joined", { name: room.name || target }))
      setAddress("")
      onOpenChange(false)
      onJoined(room.roomId)
    } catch (error) {
      toast.error(describeMatrixError(error, t("invite.acceptFailed")))
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader>
            <DialogTitle>{t("join.title")}</DialogTitle>
            <DialogDescription>{t("join.description")}</DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-2">
            <Label htmlFor="join-address">{t("join.address")}</Label>
            <Input
              id="join-address"
              placeholder="#community:matrix.org"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              disabled={isJoining}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isJoining || !address.trim()}>
              {isJoining && <Spinner className="mr-2 h-4 w-4" />}
              {t("join.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
