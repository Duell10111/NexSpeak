"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
import { AtSign, Hash, PlusCircle, SendHorizonal, Smile, Upload, X } from "lucide-react"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useRoomTimeline } from "@/hooks/useRoomTimeline"
import { useRoomInfo } from "@/hooks/useRoomInfo"
import { useReadReceipt } from "@/hooks/useReadReceipt"
import { useTypingMembers, useTypingNotifier } from "@/hooks/useTyping"
import { Trans, useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { deleteMessage, sendAttachment, sendTextMessage } from "@nexspeak/core/matrix/messages"
import { EmojiPicker } from "@/components/nexspeak/emoji-picker"
import { DateDivider, MessageItem, type MessageActions } from "@/components/nexspeak/message-item"
import type { MatrixMessage } from "@nexspeak/core/matrix/types"

interface RoomChatProps {
  roomId: string
  /** Narrow side panel next to a call: smaller paddings, no welcome header. */
  compact?: boolean
}

const GROUP_WINDOW_MS = 5 * 60 * 1000
const LOAD_MORE_THRESHOLD_PX = 200
const STICK_TO_BOTTOM_THRESHOLD_PX = 80
const MAX_COMPOSER_HEIGHT_PX = 200
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

export function RoomChat({ roomId, compact = false }: RoomChatProps) {
  const [inputValue, setInputValue] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [replyTo, setReplyTo] = useState<MatrixMessage | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MatrixMessage | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stickToBottomRef = useRef(true)
  const scrollHeightBeforeLoadRef = useRef<number | null>(null)

  const { t } = useTranslation()
  const { client, isCryptoReady } = useMatrixClient()
  const roomInfo = useRoomInfo(client, roomId)
  const { messages, isLoading, hasMore, loadMore } = useRoomTimeline(client, roomId)
  const typingNames = useTypingMembers(client, roomId)
  const { notifyTyping, stopTyping } = useTypingNotifier(client, roomId)

  const ownUserId = client?.getUserId() ?? ""
  const roomName = roomInfo?.name || ""
  const isDirect = roomInfo?.isDirect ?? false
  // DMs are addressed to a person (@Alice), channels by name (#general).
  const roomLabel = `${isDirect ? "@" : "#"}${roomName}`
  const isEncryptedRoom = roomInfo?.isEncrypted ?? false
  const canSend = Boolean(client && roomInfo?.exists && (!isEncryptedRoom || isCryptoReady))
  const latestSentEvent = messages.findLast((message) => message.status === "sent")?.event

  // Mounted means visible: the chat is the main view or open next to the call.
  useReadReceipt(client, roomId, latestSentEvent, true)

  // A newly opened room starts scrolled to the newest message.
  useLayoutEffect(() => {
    stickToBottomRef.current = true
    scrollHeightBeforeLoadRef.current = null
  }, [roomId])

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
    if (!element || isLoading || !hasMore) return
    if (element.scrollHeight <= element.clientHeight) void loadMore()
  }, [messages, isLoading, hasMore, loadMore])

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

  const resizeComposer = () => {
    const element = composerRef.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT_PX)}px`
  }

  const handleSend = () => {
    const body = inputValue.trim()
    if (!body || !client || !canSend) return

    const replyEvent = replyTo?.event
    setInputValue("")
    setReplyTo(null)
    stopTyping()
    requestAnimationFrame(resizeComposer)
    stickToBottomRef.current = true

    // The local echo shows up immediately; failures stay in the timeline with a retry action.
    sendTextMessage(client, roomId, body, replyEvent).catch((error: unknown) => {
      toast.error(describeMatrixError(error, t("chat.sendFailed")))
    })
  }

  const insertEmoji = (emoji: string) => {
    const element = composerRef.current
    const start = element?.selectionStart ?? inputValue.length
    const end = element?.selectionEnd ?? inputValue.length
    setInputValue(inputValue.slice(0, start) + emoji + inputValue.slice(end))
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + emoji.length, start + emoji.length)
      resizeComposer()
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    } else if (event.key === "Escape" && replyTo) {
      setReplyTo(null)
    } else if (event.key === "ArrowUp" && !inputValue) {
      // Like Discord: arrow up in an empty composer edits your last message.
      const lastOwn = messages.findLast(
        (message) => message.senderId === ownUserId && message.status === "sent" && message.kind === "text",
      )
      if (lastOwn) {
        event.preventDefault()
        setEditingId(lastOwn.id)
      }
    }
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
        await sendAttachment(client, roomId, file, isEncryptedRoom, replyEvent)
      }
    } catch (error) {
      toast.error(describeMatrixError(error, t("chat.uploadFailed")))
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    void uploadFiles(files)
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    void uploadFiles(files)
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
    }),
    [handleEditEnd],
  )

  const room = client?.getRoom(roomId)
  const canDelete = (message: MatrixMessage) =>
    message.status === "sent" &&
    message.kind !== "redacted" &&
    Boolean(room && ownUserId && room.currentState.maySendRedactionForEvent(message.event, ownUserId))

  const composerPlaceholder = !roomInfo?.exists
    ? t("chat.loadingRoom")
    : isEncryptedRoom && !isCryptoReady
      ? t("chat.cryptoUnavailable")
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

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite">
        <div className="flex min-h-full flex-col justify-end pb-4">
          {hasMore || isLoading ? (
            <div className="flex justify-center py-4 text-muted-foreground">
              <Spinner className="h-5 w-5" />
            </div>
          ) : (
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
            const previous = messages[index - 1]
            const newDay = !previous || !isSameDay(previous.timestamp, message.timestamp)
            const isContinuation =
              !newDay &&
              previous.senderId === message.senderId &&
              message.timestamp - previous.timestamp < GROUP_WINDOW_MS &&
              message.kind !== "emote"

            return (
              <div key={message.id}>
                {newDay && <DateDivider timestamp={message.timestamp} />}
                <MessageItem
                  message={message}
                  isContinuation={isContinuation}
                  isOwn={message.senderId === ownUserId}
                  canDelete={canDelete(message)}
                  isEditing={editingId === message.id}
                  actions={actions}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Message input */}
      <div className={cn("shrink-0", compact ? "px-3" : "px-2 sm:px-4")}>
        {replyTo && (
          <div className="flex items-center justify-between gap-2 rounded-t-lg bg-secondary px-4 py-2 text-sm text-muted-foreground">
            <span className="truncate">
              <Trans k="chat.replyingTo" values={{ name: <span className="font-semibold text-foreground">{replyTo.senderName}</span> }} />
            </span>
            <button
              onClick={() => setReplyTo(null)}
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
              aria-label={t("chat.cancelReply")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className={cn("flex items-start gap-1 bg-nx-chat-input pr-2 pl-1", replyTo ? "rounded-b-lg" : "rounded-lg")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                aria-label={t("chat.attachFile")}
                disabled={!canSend || isUploading}
              >
                {isUploading ? <Spinner className="h-5 w-5" /> : <PlusCircle className="h-6 w-6" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{isEncryptedRoom ? t("chat.attachFileEncrypted") : t("chat.attachFile")}</TooltipContent>
          </Tooltip>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelected} />
          <textarea
            ref={composerRef}
            rows={1}
            value={inputValue}
            onChange={(event) => {
              setInputValue(event.target.value)
              notifyTyping(event.target.value.length > 0)
              resizeComposer()
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={stopTyping}
            placeholder={composerPlaceholder}
            aria-label={t("chat.message")}
            className="max-h-[200px] min-w-0 flex-1 resize-none bg-transparent py-[11px] text-[15px] leading-[22px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
            disabled={!canSend}
          />
          <div className="flex h-11 shrink-0 items-center gap-1">
            <EmojiPicker onSelect={insertEmoji}>
              <button
                className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                aria-label={t("chat.insertEmoji")}
                disabled={!canSend}
              >
                <Smile className="h-6 w-6" />
              </button>
            </EmojiPicker>
            {inputValue.trim() && (
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                aria-label={t("chat.send")}
              >
                <SendHorizonal className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex h-6 items-center px-1 text-xs text-muted-foreground" aria-live="polite">
          <TypingIndicator names={typingNames} />
        </div>
      </div>

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
