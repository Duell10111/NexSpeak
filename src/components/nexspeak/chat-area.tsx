"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Hash,
  Bell,
  Pin,
  Users,
  Search,
  Inbox,
  HelpCircle,
  PlusCircle,
  Gift,
  Sticker,
  Smile,
  SendHorizonal,
} from "lucide-react"
import { useCallContext } from "@/components/nexspeak/call-context"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useRoomTimeline } from "@/hooks/useRoomTimeline"
import { CallArea } from "@/components/nexspeak/call-area"
import type { MatrixMessage } from "@/lib/matrix/types"

interface ChatAreaProps {
  activeServerId: string
  activeChannelId: string
  showMembers: boolean
  onToggleMembers: () => void
}

// ...existing code...

function MatrixMessageItem({ message }: { message: MatrixMessage }) {
  const timestamp = new Date(message.timestamp)
  const hours = timestamp.getHours().toString().padStart(2, "0")
  const minutes = timestamp.getMinutes().toString().padStart(2, "0")

  return (
    <div className="group flex gap-4 px-4 py-1 hover:bg-nx-hover/50 transition-colors">
      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
        {message.senderName?.charAt(0).toUpperCase() || "?"}
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold hover:underline cursor-pointer text-foreground">
            {message.senderName}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {hours}:{minutes}
          </span>
          {message.edited && (
            <span className="text-[10px] text-muted-foreground">(bearbeitet)</span>
          )}
        </div>
        <p className="text-sm text-foreground leading-relaxed break-words">{message.content}</p>
      </div>
    </div>
  )
}

export function ChatArea({
  activeServerId: _activeServerId,
  activeChannelId,
  showMembers,
  onToggleMembers,
}: ChatAreaProps) {
  void _activeServerId

  const [inputValue, setInputValue] = useState("")
  const [isSending, setIsSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const {
    isInCallInActiveChannel,
    callParticipants,
    callVideoFeeds,
    isMicMuted,
    isScreensharing,
    isDeafened,
    toggleMicrophone,
    toggleScreenshare,
    toggleHeadphones,
    leaveActiveCall,
  } = useCallContext()

  const { client, isCryptoReady } = useMatrixClient()
  const { messages: matrixMessages, isLoading: timelineLoading, hasMore, loadMore } = useRoomTimeline(
    client,
    activeChannelId,
  )

  // Only use matrix timeline; do not use any mock/local messages
  const displayMessages: MatrixMessage[] = matrixMessages || []

  // Get room info for header
  const room = client ? client.getRoom(activeChannelId) : undefined
  const roomName = room?.name || (room && room.getCanonicalAlias ? room.getCanonicalAlias() : activeChannelId)
  const roomTopicEvent = room?.currentState.getStateEvents('m.room.topic', '')
  const roomTopic = roomTopicEvent?.getContent()?.topic
  const roomEncryptionState = room?.currentState.getStateEvents('m.room.encryption', '')
  const isEncryptedRoom = Boolean(roomEncryptionState)
  const isInCall = isInCallInActiveChannel

  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector("[data-slot='scroll-area-viewport']")
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
    }
  }, [displayMessages.length])

  const handleSend = async () => {
    if (!inputValue.trim() || !client || !activeChannelId) return
    if (isEncryptedRoom && !isCryptoReady) return

    setIsSending(true)
    try {
      // sendMessage respects room encryption when crypto is initialized.
      await client.sendTextMessage(activeChannelId, inputValue.trim())
      // Clear composer; message will appear via timeline when echoed by server
      setInputValue("")
    } catch (error) {
      console.error('Failed to send message:', error)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      {/* Channel header */}
      <header className="flex h-12 items-center justify-between border-b border-border px-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Hash className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-[15px] font-semibold text-foreground">{roomName || 'Unnamed room'}</h3>
          {roomTopic && (
            <>
              <div className="mx-2 h-6 w-px bg-border" />
              <span className="truncate text-sm text-muted-foreground">{roomTopic}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Benachrichtigungen">
                <Bell className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Benachrichtigungen</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Angeheftete Nachrichten">
                <Pin className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Angeheftete Nachrichten</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onToggleMembers}
                className={cn("transition-colors", showMembers ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                aria-label="Mitgliederliste"
              >
                <Users className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Mitgliederliste</TooltipContent>
          </Tooltip>
          <div className="relative">
            <input type="text" placeholder="Suchen" className="h-7 w-36 rounded-md bg-input px-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:w-52 transition-all" />
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Posteingang">
                <Inbox className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Posteingang</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Hilfe">
                <HelpCircle className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Hilfe</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {isInCall ? (
        <CallArea
          participants={callParticipants}
          videoFeeds={callVideoFeeds}
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
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="flex flex-col">
          {/* Welcome banner */}
          <div className="px-4 pt-8 pb-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Hash className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mt-2 text-2xl font-bold text-foreground text-balance">{roomName ? `Willkommen bei #${roomName}!` : 'Willkommen'}</h2>
            <p className="text-sm text-muted-foreground">{roomName ? `Das ist der Anfang des #${roomName} Kanals.` : 'Wähle einen Raum.'}</p>
          </div>

          {/* Messages list */}
          <div className="flex flex-col gap-0.5 pb-4">
            {timelineLoading && <div className="p-4 text-center text-muted-foreground">Lade Nachrichten…</div>}
            {!timelineLoading && displayMessages.length === 0 && (
              <div className="p-4 text-center text-muted-foreground">Keine Nachrichten</div>
            )}

            {displayMessages.map((msg) => (
              <div key={msg.id} className="relative">
                <MatrixMessageItem message={msg} />
              </div>
            ))}

            {hasMore && (
              <div className="px-4 py-2 text-center">
                <button onClick={() => loadMore()} className="text-sm text-primary hover:underline">Mehr laden</button>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Message input */}
      <div className="px-4 pb-6 pt-1">
        <div className="flex items-center gap-2 rounded-lg bg-nx-chat-input px-4 py-2.5">
          <button className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50" aria-label="Datei anfuegen" disabled={isSending}>
            <PlusCircle className="h-5 w-5" />
          </button>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={
              isEncryptedRoom && !isCryptoReady
                ? 'Verschluesselung wird initialisiert...'
                : roomName
                  ? `Nachricht an #${roomName}`
                  : 'Nachricht'
            }
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
            disabled={isSending || !client || !room || (isEncryptedRoom && !isCryptoReady)}
          />
          <div className="flex items-center gap-2">
            <button className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50" aria-label="Geschenk" disabled={isSending}>
              <Gift className="h-5 w-5" />
            </button>
            <button className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50" aria-label="Sticker" disabled={isSending}>
              <Sticker className="h-5 w-5" />
            </button>
            <button className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50" aria-label="Emoji" disabled={isSending}>
              <Smile className="h-5 w-5" />
            </button>
            {inputValue.trim() && (
              <button
                onClick={handleSend}
                disabled={isSending || !client || !room || (isEncryptedRoom && !isCryptoReady)}
                className="rounded-md bg-primary p-1.5 text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                aria-label="Senden"
              >
                <SendHorizonal className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  )
}
