"use client"

import { useEffect, useRef, useState } from "react"
import { Pin, PinOff } from "lucide-react"
import { toast } from "sonner"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { HeaderButton } from "@/components/nexspeak/chat-area"
import { jumpToMessage } from "@/lib/jump-to-message"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { usePinnedEventIds } from "@/hooks/usePinnedEvents"
import { useIgnoredUsers } from "@/hooks/useIgnoredUsers"
import { useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { canPinMessages, loadPinnedEvent, setPinned } from "@nexspeak/core/matrix/pins"
import { eventToMatrixMessage, summarizeEvent, type MatrixMessage } from "@nexspeak/core/matrix/types"

interface PinnedEntry {
  eventId: string
  message: MatrixMessage | null
  summary: string
}

function PinnedList({ roomId, pinnedIds, onJump }: { roomId: string; pinnedIds: string[]; onJump: () => void }) {
  const { t, intl } = useTranslation()
  const { client } = useMatrixClient()
  const ignored = useIgnoredUsers(client)
  const [entries, setEntries] = useState<{ key: string; list: PinnedEntry[] } | null>(null)
  const key = pinnedIds.join("|")
  const room = client?.getRoom(roomId)
  const canPin = canPinMessages(room, client?.getUserId() ?? null)

  // Only loaded while the list is open: pinned events may be far back in history.
  useEffect(() => {
    if (!client || !room) return
    let cancelled = false
    const ids = key ? key.split("|").reverse() : []
    Promise.all(
      ids.map(async (eventId) => {
        const event = await loadPinnedEvent(client, room, eventId)
        const message = event ? eventToMatrixMessage(event, roomId, { room, ownUserId: client.getUserId() }) : null
        return { eventId, message, summary: event ? summarizeEvent(event) : "" }
      }),
    ).then((list) => !cancelled && setEntries({ key, list }))
    return () => {
      cancelled = true
    }
  }, [client, room, roomId, key])

  if (pinnedIds.length === 0) {
    return <p className="p-4 text-center text-sm text-muted-foreground">{t("pins.empty")}</p>
  }
  if (!entries || entries.key !== key) {
    return (
      <div className="flex justify-center p-4">
        <Spinner className="h-5 w-5 text-muted-foreground" />
      </div>
    )
  }

  const unpin = (eventId: string) => {
    if (!client) return
    setPinned(client, roomId, eventId, false).catch((error: unknown) => toast.error(describeMatrixError(error, t("pins.failed"))))
  }

  const visible = entries.list.filter(({ message }) => !message || !ignored.includes(message.senderId))
  if (!visible.length) return <p className="p-4 text-center text-sm text-muted-foreground">{t("pins.empty")}</p>

  return (
    <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
      {visible.map(({ eventId, message, summary }) => (
        <li key={eventId} className="group flex gap-2 px-3 py-2">
          <button
            className="flex min-w-0 flex-1 gap-2 text-left"
            onClick={() => {
              if (jumpToMessage(eventId)) onJump()
              else toast.info(t("pins.notLoaded"))
            }}
          >
            {message ? (
              <>
                <MatrixAvatar mxcUrl={message.senderAvatarMxc} name={message.senderName} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{message.senderName}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(message.timestamp).toLocaleDateString(intl)}
                    </span>
                  </span>
                  <span className="line-clamp-3 text-sm break-words text-muted-foreground">{summary}</span>
                </span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground italic">{t("pins.unavailable")}</span>
            )}
          </button>
          {canPin && (
            <button
              onClick={() => unpin(eventId)}
              className="self-start rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={t("pins.unpin")}
            >
              <PinOff className="h-4 w-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Header button with the room's pinned messages, like Discord's pin list. */
export function PinnedMessagesButton({ roomId }: { roomId: string }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const pinnedIds = usePinnedEventIds(client, roomId)
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span ref={anchorRef} className="relative flex">
          <HeaderButton label={t("pins.title")} active={open} onClick={() => setOpen(!open)}>
            <Pin className="h-5 w-5" />
          </HeaderButton>
          {pinnedIds.length > 0 && (
            <span className="pointer-events-none absolute -top-1 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-nx-dnd px-0.5 text-[9px] font-bold text-white">
              {pinnedIds.length}
            </span>
          )}
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-96 max-w-[calc(100vw-1rem)] p-0"
        // The header button toggles the list itself.
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault()
        }}
      >
        <h3 className="border-b border-border px-3 py-2 text-sm font-semibold text-foreground">{t("pins.title")}</h3>
        {open && <PinnedList roomId={roomId} pinnedIds={pinnedIds} onJump={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  )
}
