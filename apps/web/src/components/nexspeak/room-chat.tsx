"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { jumpToMessage } from "@/lib/jump-to-message"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
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
import { AtSign, Hash, Upload } from "lucide-react"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useRoomTimeline } from "@/hooks/useRoomTimeline"
import { useRoomInfo } from "@/hooks/useRoomInfo"
import { useReadReceipt } from "@/hooks/useReadReceipt"
import { useTypingMembers, useTypingNotifier } from "@/hooks/useTyping"
import { Trans, useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { sendPoll } from "@nexspeak/core/matrix/polls"
import { deleteMessage, sendAttachment, sendGif, sendTextMessage, sendSticker } from "@nexspeak/core/matrix/messages"
import type { Gif } from "@nexspeak/core/gifs"
import { prepareGifUpload } from "@/lib/gif-upload"
import { MessageComposer, type ComposedMessage, type MessageComposerHandle } from "@/components/nexspeak/message-composer"
import { ReportDialog } from "@/components/nexspeak/report-dialog"
import { usePinnedEventIds } from "@/hooks/usePinnedEvents"
import { canPinMessages, setPinned } from "@nexspeak/core/matrix/pins"
import { DateDivider, MessageItem, type MessageActions } from "@/components/nexspeak/message-item"
import type { MatrixMessage } from "@nexspeak/core/matrix/types"

interface RoomChatProps {
  roomId: string
  targetEventId?: string
  onReturnToLatest?: () => void
  /** Narrow side panel next to a call: smaller paddings, no welcome header. */
  compact?: boolean
  /** Show this thread (root first, then its replies) instead of the channel. */
  threadId?: string
  /** Opens a thread in the side panel; threads don't nest, so unset inside one. */
  onOpenThread?: (rootId: string) => void
}

const GROUP_WINDOW_MS = 5 * 60 * 1000
const LOAD_MORE_THRESHOLD_PX = 200
const STICK_TO_BOTTOM_THRESHOLD_PX = 80
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

function TypingIndicator({ names }: { names: string[] }) {
  const { t } = useTranslation()
  if (names.length === 0) return null

  const strong = (name: string) => <strong className="font-semibold text-foreground">{name}</strong>
  const label =
    names.length === 1 ? (
      <Trans k="chat.typingOne" values={{ name: strong(names[0]) }} />
    ) : names.length === 2 ? (
      <Trans k="chat.typingTwo" values={{ first: strong(names[0]), second: strong(names[1]) }} />
    ) : (
      t("chat.typingMany")
    )

  return (
    <span className="flex items-center gap-1.5">
      <span className="flex gap-0.5" aria-hidden>
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/70"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span className="truncate">{label}</span>
    </span>
  )
}

export function RoomChat({ roomId, compact = false, threadId, onOpenThread, targetEventId, onReturnToLatest }: RoomChatProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [replyTo, setReplyTo] = useState<MatrixMessage | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MatrixMessage | null>(null)
  const [reporting, setReporting] = useState<MatrixMessage | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<MessageComposerHandle>(null)
  const stickToBottomRef = useRef(true)
  const scrollHeightBeforeLoadRef = useRef<number | null>(null)

  const { t } = useTranslation()
  const { client, isCryptoReady } = useMatrixClient()
  const roomInfo = useRoomInfo(client, roomId)
  const { messages: timeline, isLoading, hasMore, loadMore, contextError } = useRoomTimeline(client, roomId, threadId, targetEventId)
  // In a thread the root stays on top, above the (paginated) replies.
  const threadRoot = threadId && timeline[0]?.id === threadId ? timeline[0] : null
  const messages = threadRoot ? timeline.slice(1) : timeline
  // Typing notifications are per room in Matrix; a thread shows them in the channel only.
  const roomTypingNames = useTypingMembers(client, roomId)
  const typingNames = threadId ? [] : roomTypingNames
  const pinnedIds = usePinnedEventIds(client, roomId)
  const { notifyTyping, stopTyping } = useTypingNotifier(client, roomId)

  const ownUserId = client?.getUserId() ?? ""
  const roomName = roomInfo?.name || ""
  const isDirect = roomInfo?.isDirect ?? false
  // DMs are addressed to a person (@Alice), channels by name (#general).
  const roomLabel = `${isDirect ? "@" : "#"}${roomName}`
  const isEncryptedRoom = roomInfo?.isEncrypted ?? false
  const canSend = Boolean(client && roomInfo?.canSendMessages && (!isEncryptedRoom || isCryptoReady))
  const latestSentEvent = timeline.findLast((message) => message.status === "sent")?.event

  // Mounted means visible: the chat is the main view or open next to the call.
  useReadReceipt(client, roomId, latestSentEvent, !targetEventId)

  const jumpedTargetRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!targetEventId) {
      jumpedTargetRef.current = null
      stickToBottomRef.current = true
      return
    }
    stickToBottomRef.current = false
    if (jumpedTargetRef.current !== targetEventId && jumpToMessage(targetEventId)) {
      jumpedTargetRef.current = targetEventId
    }
  }, [targetEventId, timeline])

  // A newly opened room starts scrolled to the newest message.
  useLayoutEffect(() => {
    stickToBottomRef.current = !targetEventId
    scrollHeightBeforeLoadRef.current = null
  }, [roomId, targetEventId])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return

    if (scrollHeightBeforeLoadRef.current !== null) {
      // Older messages were prepended: keep the visible messages where they were.
      element.scrollTop += element.scrollHeight - scrollHeightBeforeLoadRef.current
      scrollHeightBeforeLoadRef.current = null
    } else if (stickToBottomRef.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [messages, typingNames.length])

  // Keep loading history until the viewport is filled, so scrolling up is possible at all.
  useEffect(() => {
    const element = scrollRef.current
    if (!element || targetEventId || isLoading || !hasMore) return
    if (element.scrollHeight <= element.clientHeight) void loadMore()
  }, [messages, isLoading, hasMore, loadMore, targetEventId])

  const handleScroll = () => {
    const element = scrollRef.current
    if (!element) return

    stickToBottomRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < STICK_TO_BOTTOM_THRESHOLD_PX

    if (element.scrollTop < LOAD_MORE_THRESHOLD_PX && hasMore && !isLoading) {
      scrollHeightBeforeLoadRef.current = element.scrollHeight
      void loadMore()
    }
  }

  const resumeAfterSend = () => {
    if (!targetEventId) return
    onReturnToLatest?.()
    if (threadId) onOpenThread?.(threadId)
  }

  const handleSend = ({ body, mentions, mentionsRoom, customEmojis, hideLinkPreviews }: ComposedMessage) => {
    if (!client || !canSend) return
    const replyEvent = replyTo?.event
    setReplyTo(null)
    stickToBottomRef.current = true

    // The local echo shows up immediately; failures stay in the timeline with a retry action.
    sendTextMessage(client, roomId, body, { replyTo: replyEvent, mentions, mentionsRoom, customEmojis, hideLinkPreviews, ...threadTarget() }).catch((error: unknown) => {
      toast.error(describeMatrixError(error, t("chat.sendFailed")))
    })
    resumeAfterSend()
  }

  const threadTarget = () =>
    threadId ? { threadRootId: threadId, threadLatestEventId: messages.findLast((message) => message.status === "sent")?.id } : {}

  // Like Discord: arrow up in an empty composer edits your last message.
  const editLastMessage = () => {
    const lastOwn = messages.findLast(
      (message) => message.senderId === ownUserId && message.status === "sent" && message.kind === "text",
    )
    if (lastOwn) setEditingId(lastOwn.id)
    return Boolean(lastOwn)
  }

  const uploadFiles = async (files: File[]) => {
    if (!client || !canSend || files.length === 0) return

    const tooLarge = files.find((file) => file.size > MAX_UPLOAD_BYTES)
    if (tooLarge) {
      toast.error(t("chat.fileTooLarge", { name: tooLarge.name }))
      return
    }

    const replyEvent = replyTo?.event
    setReplyTo(null)
    setIsUploading(true)
    stickToBottomRef.current = true
    try {
      for (const file of files) {
        await sendAttachment(client, roomId, file, isEncryptedRoom, { replyTo: replyEvent, ...threadTarget() })
        resumeAfterSend()
      }
    } catch (error) {
      toast.error(describeMatrixError(error, t("chat.uploadFailed")))
    } finally {
      setIsUploading(false)
    }
  }

  // Downloaded and uploaded like an attachment, so recipients never contact the GIF provider.
  const sendPickedGif = async (gif: Gif) => {
    if (!client || !canSend) return
    const options = { replyTo: replyTo?.event, ...threadTarget() }
    setReplyTo(null)
    setIsUploading(true)
    stickToBottomRef.current = true
    try {
      await sendGif(client, roomId, await prepareGifUpload(gif), isEncryptedRoom, options)
      resumeAfterSend()
    } catch (error) {
      toast.error(describeMatrixError(error, t("gif.sendFailed")))
    } finally {
      setIsUploading(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    void uploadFiles(Array.from(event.dataTransfer.files))
  }

  const confirmDelete = () => {
    const target = pendingDelete
    setPendingDelete(null)
    if (!client || !target) return
    deleteMessage(client, target.roomId, target.id).catch((error: unknown) => {
      toast.error(describeMatrixError(error, t("chat.deleteFailed")))
    })
  }

  const handleEditEnd = useCallback(() => {
    setEditingId(null)
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [])

  const actions = useMemo<MessageActions>(
    () => ({
      onReply: (message) => {
        setReplyTo(message)
        composerRef.current?.focus()
      },
      onEditStart: setEditingId,
      onEditEnd: handleEditEnd,
      onDelete: setPendingDelete,
      onReport: setReporting,
      onOpenThread,
      onSetPinned: (message, pinned) => {
        if (!client) return
        setPinned(client, message.roomId, message.id, pinned).catch((error: unknown) => {
          toast.error(describeMatrixError(error, t("pins.failed")))
        })
      },
    }),
    [handleEditEnd, client, t, onOpenThread],
  )

  const room = client?.getRoom(roomId)
  const canPin = canPinMessages(room, ownUserId)
  const canDelete = (message: MatrixMessage) =>
    message.status === "sent" &&
    message.kind !== "redacted" &&
    Boolean(room && ownUserId && room.currentState.maySendRedactionForEvent(message.event, ownUserId))

  const renderMessage = (message: MatrixMessage, isContinuation: boolean) => (
    <MessageItem
      message={message}
      isContinuation={isContinuation}
      isOwn={message.senderId === ownUserId}
      canDelete={canDelete(message)}
      isEditing={editingId === message.id}
      isPinned={pinnedIds.includes(message.id)}
      canPin={canPin}
      actions={actions}
    />
  )

  const composerPlaceholder = !roomInfo?.exists
    ? t("chat.loadingRoom")
    : !roomInfo.canSendMessages
      ? t("chat.readOnly")
      : isEncryptedRoom && !isCryptoReady
        ? t("chat.cryptoUnavailable")
        : threadId
          ? t("thread.replyPlaceholder")
          : t("chat.messageTo", { room: roomLabel })

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onDragOver={(event) => {
        if (!canSend || !event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false)
      }}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-background/90 text-sm text-foreground">
          <Upload className="h-8 w-8 text-primary" />
          {t("chat.dropFiles", { room: roomLabel })}
        </div>
      )}

      {targetEventId && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm" role="status">
          <span>{contextError ? t("messageSearch.contextFailed") : t("messageSearch.viewingContext")}</span>
          <Button variant="outline" size="sm" onClick={onReturnToLatest}>{t("messageSearch.latest")}</Button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite">
        <div className="flex min-h-full flex-col justify-end pb-4">
          {threadId && (
            <div className="border-b border-border pb-2">
              {threadRoot ? renderMessage(threadRoot, false) : <Spinner className="mx-auto my-4 h-5 w-5 text-muted-foreground" />}
            </div>
          )}
          {hasMore || isLoading ? (
            <div className="flex justify-center py-4 text-muted-foreground">
              <Spinner className="h-5 w-5" />
            </div>
          ) : threadId ? null : (
            <div className={cn("px-4 pb-4", compact ? "pt-4" : "pt-8")}>
              <div
                className={cn(
                  "flex items-center justify-center rounded-full bg-muted",
                  compact ? "h-12 w-12" : "h-[68px] w-[68px]",
                )}
              >
                {isDirect ? (
                  <AtSign className={cn("text-foreground", compact ? "h-6 w-6" : "h-10 w-10")} />
                ) : (
                  <Hash className={cn("text-foreground", compact ? "h-6 w-6" : "h-10 w-10")} />
                )}
              </div>
              <h2 className={cn("mt-2 font-bold text-balance text-foreground", compact ? "text-xl" : "text-[32px] leading-10")}>
                {isDirect ? roomName : t("chat.welcome", { room: roomLabel })}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isDirect ? t("chat.dmStart", { name: roomName }) : t("chat.roomStart", { room: roomLabel })}
              </p>
            </div>
          )}

          {messages.map((message, index) => {
            // In a thread the first reply follows the root.
            const previous = messages[index - 1] ?? threadRoot ?? undefined
            const newDay = !previous || !isSameDay(previous.timestamp, message.timestamp)
            const isContinuation =
              !newDay &&
              previous.senderId === message.senderId &&
              message.timestamp - previous.timestamp < GROUP_WINDOW_MS &&
              message.kind !== "emote"

            return (
              <div key={message.id}>
                {newDay && <DateDivider timestamp={message.timestamp} />}
                {renderMessage(message, isContinuation)}
              </div>
            )
          })}
        </div>
      </div>

      {/* Message input */}
      <div className={cn("shrink-0", compact ? "px-3" : "px-2 sm:px-4")}>
        <MessageComposer
          ref={composerRef}
          roomId={roomId}
          placeholder={composerPlaceholder}
          disabled={!canSend}
          replyToName={replyTo?.senderName}
          onCancelReply={() => setReplyTo(null)}
          onSend={handleSend}
          onPoll={threadId ? undefined : async (draft) => {
            if (!client || !canSend) throw new Error("Room is not ready to send polls")
            stickToBottomRef.current = true
            await sendPoll(client, roomId, draft)
          }}
          onSticker={(sticker) => {
            if (!client || !canSend) return
            const options = { replyTo: replyTo?.event, ...threadTarget() }
            setReplyTo(null)
            stickToBottomRef.current = true
            sendSticker(client, roomId, sticker, options).catch((error: unknown) => {
              toast.error(describeMatrixError(error, t('chat.sendFailed')))
            })
            resumeAfterSend()
          }}
          onGif={(gif) => void sendPickedGif(gif)}
          onFiles={(files) => void uploadFiles(files)}
          isUploading={isUploading}
          attachLabel={isEncryptedRoom ? t("chat.attachFileEncrypted") : t("chat.attachFile")}
          onEditLast={editLastMessage}
          onTyping={notifyTyping}
          onStopTyping={stopTyping}
        />
        <div className="flex h-6 items-center px-1 text-xs text-muted-foreground" aria-live="polite">
          <TypingIndicator names={typingNames} />
        </div>
      </div>

      <ReportDialog
        target={
          reporting
            ? { kind: "message", roomId, eventId: reporting.id, senderId: reporting.senderId, senderName: reporting.senderName }
            : null
        }
        onOpenChange={(open) => !open && setReporting(null)}
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chat.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("chat.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-white hover:bg-destructive/90">
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
