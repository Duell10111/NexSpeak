"use client"

import { useEffect, useState } from "react"
import { ThreadEvent, type Thread } from "matrix-js-sdk"
import { ArrowLeft, MessagesSquare, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { RoomChat } from "@/components/nexspeak/room-chat"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { fetchThreadList, sortedThreads } from "@nexspeak/core/matrix/threads"
import { summarizeEvent } from "@nexspeak/core/matrix/types"
import { isIgnoredEvent, subscribeIgnoredUsers } from "@nexspeak/core/matrix/safety"

export type ThreadPanelView = { kind: "list" } | { kind: "thread"; rootId: string }

function useThreads(roomId: string): { threads: Thread[]; isLoading: boolean } {
  const { client } = useMatrixClient()
  const [state, setState] = useState<{ roomId: string; threads: Thread[]; loaded: boolean } | null>(null)

  useEffect(() => {
    const room = client?.getRoom(roomId)
    if (!client || !room) return
    let cancelled = false
    let frame: number | null = null
    const refresh = (loaded: boolean) => {
      if (cancelled) return
      setState((previous) => ({ roomId, threads: sortedThreads(room), loaded: loaded || Boolean(previous?.loaded) }))
    }
    const scheduleRefresh = () => {
      if (frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null
          refresh(false)
        })
      }
    }

    queueMicrotask(() => refresh(false))
    const unsubscribeIgnored = subscribeIgnoredUsers(client, scheduleRefresh)
    fetchThreadList(room)
      .catch((error: unknown) => console.warn("Loading the thread list failed:", error))
      .finally(() => refresh(true))
    room.on(ThreadEvent.New, scheduleRefresh)
    room.on(ThreadEvent.Update, scheduleRefresh)
    return () => {
      cancelled = true
      if (frame !== null) cancelAnimationFrame(frame)
      unsubscribeIgnored()
      room.removeListener(ThreadEvent.New, scheduleRefresh)
      room.removeListener(ThreadEvent.Update, scheduleRefresh)
    }
  }, [client, roomId])

  const current = state?.roomId === roomId ? state : null
  return { threads: current?.threads ?? [], isLoading: !current?.loaded }
}

function ThreadList({ roomId, onOpen }: { roomId: string; onOpen: (rootId: string) => void }) {
  const { t, intl } = useTranslation()
  const { client } = useMatrixClient()
  const { threads, isLoading } = useThreads(roomId)

  if (threads.length === 0) {
    return isLoading ? (
      <div className="flex justify-center p-6">
        <Spinner className="h-5 w-5 text-muted-foreground" />
      </div>
    ) : (
      <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <MessagesSquare className="h-8 w-8" />
        <p>{t("thread.none")}</p>
      </div>
    )
  }

  return (
    <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
      {threads.map((thread) => {
        const root = thread.rootEvent!
        const latest = isIgnoredEvent(client ?? undefined, thread.replyToEvent) ? undefined : thread.replyToEvent
        const senderName = root.sender?.name || root.getSender() || ""
        return (
          <li key={thread.id}>
            <button onClick={() => onOpen(thread.id)} className="flex w-full gap-2 px-3 py-2.5 text-left hover:bg-nx-hover">
              <MatrixAvatar mxcUrl={root.sender?.getMxcAvatarUrl()} name={senderName} size={32} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{senderName}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {new Date(latest?.getTs() ?? root.getTs()).toLocaleDateString(intl)}
                  </span>
                </span>
                <span className="line-clamp-2 text-sm break-words text-foreground">{summarizeEvent(root)}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  <span className={cn("font-semibold", thread.hasCurrentUserParticipated ? "text-primary" : "")}>
                    {(thread.length === 1 ? t("thread.replyOne") : t("thread.replies", { count: thread.length }))}
                  </span>
                  {latest && ` · ${latest.sender?.name || latest.getSender()}: ${summarizeEvent(latest)}`}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Discord's thread sidebar: the thread list of the channel, or one thread with its own composer.
 * Only mounted while open, so it costs nothing otherwise.
 */
export function ThreadPanel({
  roomId,
  view,
  onViewChange,
  onClose,
  className,
}: {
  roomId: string
  view: ThreadPanelView
  onViewChange: (view: ThreadPanelView) => void
  onClose: () => void
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <aside
      className={cn("flex h-full min-w-0 flex-col border-l border-nx-guild-bar bg-background", className)}
      aria-label={view.kind === "list" ? t("thread.list") : t("thread.title")}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-nx-guild-bar px-3">
        {view.kind === "thread" && (
          <button
            onClick={() => onViewChange({ kind: "list" })}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("thread.backToList")}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <MessagesSquare className="h-5 w-5 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {view.kind === "list" ? t("thread.list") : t("thread.title")}
        </h3>
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("common.close")}>
          <X className="h-4 w-4" />
        </button>
      </header>
      {view.kind === "list" ? (
        <ThreadList roomId={roomId} onOpen={(rootId) => onViewChange({ kind: "thread", rootId })} />
      ) : (
        <RoomChat key={view.rootId} roomId={roomId} threadId={view.rootId} compact />
      )}
    </aside>
  )
}
