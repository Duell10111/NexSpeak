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
import { Hash, Lock, Menu, Phone, PlusCircle, SendHorizonal, Upload, Users, X } from "lucide-react"
import { useCallContext } from "@/components/nexspeak/call-context"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useRoomTimeline } from "@/hooks/useRoomTimeline"
import { useRoomInfo } from "@/hooks/useRoomInfo"
import { useReadReceipt } from "@/hooks/useReadReceipt"
import { useTypingMembers, useTypingNotifier } from "@/hooks/useTyping"
import { describeMatrixError } from "@/lib/matrix/errors"
import { deleteMessage, sendAttachment, sendTextMessage } from "@/lib/matrix/messages"
import { CallArea } from "@/components/nexspeak/call-area"
import { DateDivider, MessageItem, type MessageActions } from "@/components/nexspeak/message-item"
import type { MatrixMessage } from "@/lib/matrix/types"

interface ChatAreaProps {
  activeChannelId: string
  showMembers: boolean
  onToggleMembers: () => void
  /** Mobile only: open the server/channel navigation. */
  onOpenNavigation: () => void
}

const GROUP_WINDOW_MS = 5 * 60 * 1000
const LOAD_MORE_THRESHOLD_PX = 200
const STICK_TO_BOTTOM_THRESHOLD_PX = 80
const MAX_COMPOSER_HEIGHT_PX = 200
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

function typingLabel(names: string[]): string {
  if (names.length === 1) return `${names[0]} tippt…`
  if (names.length === 2) return `${names[0]} und ${names[1]} tippen…`
  return "Mehrere Personen tippen…"
}

export function ChatArea({ activeChannelId, showMembers, onToggleMembers, onOpenNavigation }: ChatAreaProps) {
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

  const { isInCallInActiveChannel, joinCall, joiningRoomId } = useCallContext()
  const { client, isCryptoReady } = useMatrixClient()
  const roomInfo = useRoomInfo(client, activeChannelId)
  const { messages, isLoading, hasMore, loadMore } = useRoomTimeline(client, activeChannelId)
  const typingNames = useTypingMembers(client, activeChannelId)
  const { notifyTyping, stopTyping } = useTypingNotifier(client, activeChannelId)

  const ownUserId = client?.getUserId() ?? ""
  const roomName = roomInfo?.name || ""
  const isEncryptedRoom = roomInfo?.isEncrypted ?? false
  const canSend = Boolean(client && roomInfo?.exists && (!isEncryptedRoom || isCryptoReady))
  const latestSentEvent = messages.findLast((message) => message.status === "sent")?.event

  useReadReceipt(client, activeChannelId, latestSentEvent, !isInCallInActiveChannel)

  // A newly opened room starts scrolled to the newest message.
  useLayoutEffect(() => {
    stickToBottomRef.current = true
    scrollHeightBeforeLoadRef.current = null
  }, [activeChannelId])

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
    sendTextMessage(client, activeChannelId, body, replyEvent).catch((error: unknown) => {
      toast.error(describeMatrixError(error, "Nachricht konnte nicht gesendet werden."))
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
      toast.error(`„${tooLarge.name}“ ist zu groß (max. 100 MB).`)
      return
    }

    const replyEvent = replyTo?.event
    setReplyTo(null)
    setIsUploading(true)
    stickToBottomRef.current = true
    try {
      for (const file of files) {
        await sendAttachment(client, activeChannelId, file, isEncryptedRoom, replyEvent)
      }
    } catch (error) {
      toast.error(describeMatrixError(error, "Datei konnte nicht hochgeladen werden."))
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
      toast.error(describeMatrixError(error, "Nachricht konnte nicht gelöscht werden."))
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

  const room = client?.getRoom(activeChannelId)
  const canDelete = (message: MatrixMessage) =>
    message.status === "sent" &&
    message.kind !== "redacted" &&
    Boolean(room && ownUserId && room.currentState.maySendRedactionForEvent(message.event, ownUserId))

  const composerPlaceholder = !roomInfo?.exists
    ? "Raum wird geladen…"
    : isEncryptedRoom && !isCryptoReady
      ? "Verschlüsselung ist nicht verfügbar – Senden nicht möglich"
      : `Nachricht an #${roomName}`

  const header = (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-2 shadow-sm sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onOpenNavigation}
          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
          aria-label="Navigation öffnen"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Hash className="h-5 w-5 shrink-0 text-muted-foreground" />
        <h3 className="truncate text-[15px] font-semibold text-foreground">{roomName}</h3>
        {isEncryptedRoom && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Ende-zu-Ende-verschlüsselt" />
            </TooltipTrigger>
            <TooltipContent>Ende-zu-Ende-verschlüsselt</TooltipContent>
          </Tooltip>
        )}
        {roomInfo?.topic && (
          <>
            <div className="mx-2 hidden h-6 w-px shrink-0 bg-border sm:block" />
            <span className="hidden truncate text-sm text-muted-foreground sm:block" title={roomInfo.topic}>
              {roomInfo.topic}
            </span>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {!isInCallInActiveChannel && roomInfo?.exists && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => void joinCall(activeChannelId)}
                disabled={Boolean(joiningRoomId)}
                className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                aria-label="Sprachkanal beitreten"
              >
                {joiningRoomId === activeChannelId ? <Spinner className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>Sprachkanal beitreten</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggleMembers}
              className={cn("transition-colors", showMembers ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              aria-label="Mitgliederliste"
              aria-pressed={showMembers}
            >
              <Users className="h-5 w-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Mitgliederliste</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )

  if (!activeChannelId) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-12 items-center border-b border-border px-2 md:hidden">
          <button onClick={onOpenNavigation} className="rounded p-1.5 text-muted-foreground" aria-label="Navigation öffnen">
            <Menu className="h-5 w-5" />
          </button>
        </header>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Wähle einen Raum aus.</div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
      {header}

      {isInCallInActiveChannel ? (
        <CallArea />
      ) : (
        <div
          className="relative flex min-h-0 flex-1 flex-col"
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
              Dateien hier ablegen, um sie an #{roomName} zu senden
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite">
            <div className="flex flex-col pb-4">
              {hasMore || isLoading ? (
                <div className="flex justify-center py-4 text-muted-foreground">
                  <Spinner className="h-5 w-5" />
                </div>
              ) : (
                <div className="px-4 pt-8 pb-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                    <Hash className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h2 className="mt-2 text-2xl font-bold text-balance text-foreground">Willkommen bei #{roomName}!</h2>
                  <p className="text-sm text-muted-foreground">Das ist der Anfang des Raums #{roomName}.</p>
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
          <div className="shrink-0 px-2 pb-3 sm:px-4 sm:pb-6">
            <div className="h-5 truncate px-1 text-[11px] text-muted-foreground" aria-live="polite">
              {typingNames.length > 0 && typingLabel(typingNames)}
            </div>
            {replyTo && (
              <div className="flex items-center justify-between gap-2 rounded-t-lg bg-secondary px-4 py-1.5 text-xs text-muted-foreground">
                <span className="truncate">
                  Antwort an <span className="font-semibold text-foreground">{replyTo.senderName}</span>
                </span>
                <button onClick={() => setReplyTo(null)} className="rounded p-0.5 hover:bg-muted hover:text-foreground" aria-label="Antwort abbrechen">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className={cn("flex items-end gap-2 bg-nx-chat-input px-4 py-2.5", replyTo ? "rounded-b-lg" : "rounded-lg")}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    aria-label="Datei anhängen"
                    disabled={!canSend || isUploading}
                  >
                    {isUploading ? <Spinner className="h-5 w-5" /> : <PlusCircle className="h-5 w-5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{isEncryptedRoom ? "Datei verschlüsselt anhängen" : "Datei anhängen"}</TooltipContent>
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
                aria-label="Nachricht"
                className="max-h-[200px] flex-1 resize-none bg-transparent text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
                disabled={!canSend}
              />
              {inputValue.trim() && (
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  className="rounded-md bg-primary p-1.5 text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  aria-label="Senden"
                >
                  <SendHorizonal className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nachricht löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Nachricht wird für alle entfernt. Das lässt sich nicht rückgängig machen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-white hover:bg-destructive/90">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
