"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react"
import { MsgType } from "matrix-js-sdk"
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Spinner } from "@/components/ui/spinner"
import { Hash, Lock, Phone, PlusCircle, SendHorizonal, Users } from "lucide-react"
import { useCallContext } from "@/components/nexspeak/call-context"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useRoomTimeline } from "@/hooks/useRoomTimeline"
import { useRoomInfo } from "@/hooks/useRoomInfo"
import { useReadReceipt } from "@/hooks/useReadReceipt"
import { describeMatrixError } from "@/lib/matrix/errors"
import { CallArea } from "@/components/nexspeak/call-area"
import { DateDivider, MessageItem } from "@/components/nexspeak/message-item"
import type { MatrixMessage } from "@/lib/matrix/types"

interface ChatAreaProps {
  activeChannelId: string
  showMembers: boolean
  onToggleMembers: () => void
}

const GROUP_WINDOW_MS = 5 * 60 * 1000
const LOAD_MORE_THRESHOLD_PX = 200
const STICK_TO_BOTTOM_THRESHOLD_PX = 80
const MAX_COMPOSER_HEIGHT_PX = 200

function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

async function readImageSize(file: File): Promise<{ w: number; h: number } | undefined> {
  try {
    const bitmap = await createImageBitmap(file)
    const size = { w: bitmap.width, h: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return undefined
  }
}

function MessageList({ messages }: { messages: MatrixMessage[] }) {
  return (
    <>
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
            <MessageItem message={message} isContinuation={isContinuation} />
          </div>
        )
      })}
    </>
  )
}

export function ChatArea({ activeChannelId, showMembers, onToggleMembers }: ChatAreaProps) {
  const [inputValue, setInputValue] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stickToBottomRef = useRef(true)
  const scrollHeightBeforeLoadRef = useRef<number | null>(null)

  const {
    selfUserId,
    isInCallInActiveChannel,
    callParticipants,
    callVideoFeeds,
    localUserMediaStream,
    isMicMuted,
    isScreensharing,
    isDeafened,
    toggleMicrophone,
    toggleScreenshare,
    toggleHeadphones,
    leaveActiveCall,
    joinCall,
  } = useCallContext()
  const [isJoiningCall, setIsJoiningCall] = useState(false)

  const { client, isCryptoReady } = useMatrixClient()
  const roomInfo = useRoomInfo(client, activeChannelId)
  const { messages, isLoading, hasMore, loadMore } = useRoomTimeline(client, activeChannelId)

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
  }, [messages])

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

    setInputValue("")
    requestAnimationFrame(resizeComposer)
    stickToBottomRef.current = true

    // The local echo shows up immediately; failures stay in the timeline with a retry action.
    client.sendTextMessage(activeChannelId, body).catch((error: unknown) => {
      toast.error(describeMatrixError(error, "Nachricht konnte nicht gesendet werden."))
    })
  }

  const handleJoinCall = async () => {
    setIsJoiningCall(true)
    try {
      await joinCall(activeChannelId)
    } catch (error) {
      console.error("Failed to join voice call:", error)
      toast.error(describeMatrixError(error, "Dem Sprachkanal konnte nicht beigetreten werden."))
    } finally {
      setIsJoiningCall(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      handleSend()
    }
  }

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file || !client || !canSend) return

    setIsUploading(true)
    try {
      const isImage = file.type.startsWith("image/")
      const { content_uri: url } = await client.uploadContent(file, { name: file.name, type: file.type })
      const imageSize = isImage ? await readImageSize(file) : undefined

      const content = {
        msgtype: isImage ? MsgType.Image : MsgType.File,
        body: file.name,
        filename: file.name,
        url,
        info: { mimetype: file.type || undefined, size: file.size, ...imageSize },
      } as RoomMessageEventContent

      stickToBottomRef.current = true
      await client.sendMessage(activeChannelId, content)
    } catch (error) {
      toast.error(describeMatrixError(error, "Datei konnte nicht hochgeladen werden."))
    } finally {
      setIsUploading(false)
    }
  }

  const composerPlaceholder = !roomInfo?.exists
    ? "Raum wird geladen…"
    : isEncryptedRoom && !isCryptoReady
      ? "Verschlüsselung ist nicht verfügbar – Senden nicht möglich"
      : `Nachricht an #${roomName}`

  if (!activeChannelId) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center bg-background text-sm text-muted-foreground">
        Wähle links einen Raum aus.
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
      {/* Channel header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
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
              <div className="mx-2 h-6 w-px shrink-0 bg-border" />
              <span className="truncate text-sm text-muted-foreground" title={roomInfo.topic}>
                {roomInfo.topic}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!isInCallInActiveChannel && roomInfo?.exists && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => void handleJoinCall()}
                  disabled={isJoiningCall}
                  className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  aria-label="Sprachkanal beitreten"
                >
                  {isJoiningCall ? <Spinner className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
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

      {isInCallInActiveChannel ? (
        <CallArea
          selfUserId={selfUserId}
          participants={callParticipants}
          videoFeeds={callVideoFeeds}
          localUserMediaStream={localUserMediaStream}
          isMicMuted={isMicMuted}
          isDeafened={isDeafened}
          isScreensharing={isScreensharing}
          onToggleMic={() => void toggleMicrophone()}
          onToggleHeadphones={toggleHeadphones}
          onToggleScreenshare={() => void toggleScreenshare()}
          onLeaveCall={leaveActiveCall}
        />
      ) : (
        <>
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

              <MessageList messages={messages} />
            </div>
          </div>

          {/* Message input */}
          <div className="shrink-0 px-4 pb-6 pt-1">
            <div className="flex items-end gap-2 rounded-lg bg-nx-chat-input px-4 py-2.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                      aria-label="Datei anhängen"
                      disabled={!canSend || isUploading || isEncryptedRoom}
                    >
                      {isUploading ? <Spinner className="h-5 w-5" /> : <PlusCircle className="h-5 w-5" />}
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {isEncryptedRoom ? "Dateien in verschlüsselten Räumen werden noch nicht unterstützt" : "Datei anhängen"}
                </TooltipContent>
              </Tooltip>
              <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => void handleFileSelected(event)} />
              <textarea
                ref={composerRef}
                rows={1}
                value={inputValue}
                onChange={(event) => {
                  setInputValue(event.target.value)
                  resizeComposer()
                }}
                onKeyDown={handleKeyDown}
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
        </>
      )}
    </div>
  )
}
