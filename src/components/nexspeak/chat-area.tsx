"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import {
  messages as allMessages,
  getUserById,
  formatTimestamp,
  channelCategories,
  type Message,
  type Channel,
} from "@/lib/nexspeak-data"
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
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useRoomTimeline } from "@/hooks/useRoomTimeline"
import type { MatrixMessage } from "@/lib/matrix/types"

interface ChatAreaProps {
  activeServerId: string
  activeChannelId: string
  showMembers: boolean
  onToggleMembers: () => void
}

function MessageItem({ message }: { message: Message }) {
  const user = getUserById(message.userId)
  if (!user) return null

  const roleColor =
    user.role === "admin"
      ? "text-primary"
      : user.role === "moderator"
      ? "text-chart-2"
      : "text-foreground"

  return (
    <div className="group flex gap-4 px-4 py-1 hover:bg-nx-hover/50 transition-colors">
      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
        {user.avatar}
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="flex items-baseline gap-2">
          <span className={cn("text-sm font-semibold hover:underline cursor-pointer", roleColor)}>
            {user.name}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatTimestamp(message.timestamp)}
          </span>
          {message.edited && (
            <span className="text-[10px] text-muted-foreground">(bearbeitet)</span>
          )}
        </div>
        <p className="text-sm text-foreground leading-relaxed break-words">
          {message.content}
        </p>
        {message.reactions && message.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((reaction, i) => (
              <button
                key={i}
                className={cn(
                  "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs transition-colors",
                  reaction.reacted
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground hover:border-muted-foreground"
                )}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Hover actions */}
      <div className="absolute right-4 -top-3 hidden group-hover:flex items-center gap-0.5 rounded-md border border-border bg-secondary px-1 py-0.5 shadow-sm">
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors">
              <Smile className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Reaktion</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

function MatrixMessageItem({ message }: { message: MatrixMessage }) {
  const timestamp = new Date(message.timestamp)
  const hours = timestamp.getHours().toString().padStart(2, "0")
  const minutes = timestamp.getMinutes().toString().padStart(2, "0")

  return (
    <div className="group flex gap-4 px-4 py-1 hover:bg-nx-hover/50 transition-colors">
      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
        {message.senderName.charAt(0).toUpperCase()}
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
        <p className="text-sm text-foreground leading-relaxed break-words">
          {message.content}
        </p>
      </div>
    </div>
  )
}

function getChannel(serverId: string, channelId: string): Channel | undefined {
  const cats = channelCategories[serverId] || []
  for (const cat of cats) {
    const found = cat.channels.find((ch) => ch.id === channelId)
    if (found) return found
  }
  return undefined
}

export function ChatArea({
  activeServerId,
  activeChannelId,
  showMembers,
  onToggleMembers,
}: ChatAreaProps) {
  const [inputValue, setInputValue] = useState("")
  const [localMessages, setLocalMessages] = useState<Message[]>([])
  const [isSending, setIsSending] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const channel = getChannel(activeServerId, activeChannelId)

  // Check if we're using Matrix or local data
  const { client } = useMatrixClient()
  const { messages: matrixMessages } = useRoomTimeline(client, activeChannelId)
  const isMatrixRoom = client && matrixMessages.length > 0

  // Determine which messages to display
  const localChannelMessages = allMessages[activeChannelId] || []
  const displayMessages = isMatrixRoom
    ? matrixMessages
    : [...localChannelMessages, ...localMessages.filter((m) => m.id.startsWith(`local-${activeChannelId}`))]

  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector("[data-slot='scroll-area-viewport']")
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
    }
  }, [displayMessages.length])

  const handleSend = async () => {
    if (!inputValue.trim()) return

    if (isMatrixRoom && client) {
      // Send to Matrix
      setIsSending(true)
      try {
        await client.sendTextMessage(activeChannelId, inputValue.trim())
        setInputValue("")
      } catch (error) {
        console.error("Failed to send message:", error)
      } finally {
        setIsSending(false)
      }
    } else {
      // Add to local messages
      const newMsg: Message = {
        id: `local-${activeChannelId}-${Date.now()}`,
        userId: "u1",
        content: inputValue.trim(),
        timestamp: new Date(),
      }
      setLocalMessages((prev) => [...prev, newMsg])
      setInputValue("")
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      {/* Channel header */}
      <header className="flex h-12 items-center justify-between border-b border-border px-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Hash className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-[15px] font-semibold text-foreground">
            {channel?.name || "kanal"}
          </h3>
          {channel?.description && (
            <>
              <div className="mx-2 h-6 w-px bg-border" />
              <span className="truncate text-sm text-muted-foreground">
                {channel.description}
              </span>
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
                className={cn(
                  "transition-colors",
                  showMembers ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                aria-label="Mitgliederliste"
              >
                <Users className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Mitgliederliste</TooltipContent>
          </Tooltip>
          <div className="relative">
            <input
              type="text"
              placeholder="Suchen"
              className="h-7 w-36 rounded-md bg-input px-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:w-52 transition-all"
            />
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

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="flex flex-col">
          {/* Welcome banner */}
          <div className="px-4 pt-8 pb-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Hash className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mt-2 text-2xl font-bold text-foreground text-balance">
              {"Willkommen bei #"}{channel?.name || "kanal"}{"!"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {"Das ist der Anfang des #"}{channel?.name || "kanal"}{" Kanals."}
            </p>
          </div>

          {/* Messages list */}
          <div className="flex flex-col gap-0.5 pb-4">
            {displayMessages.map((msg) => (
              <div key={msg.id} className="relative">
                {"userId" in msg ? (
                  <MessageItem message={msg as Message} />
                ) : (
                  <MatrixMessageItem message={msg as MatrixMessage} />
                )}
              </div>
            ))}
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
            placeholder={`Nachricht an #${channel?.name || "kanal"}`}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
            disabled={isSending}
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
                disabled={isSending}
                className="rounded-md bg-primary p-1.5 text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                aria-label="Senden"
              >
                <SendHorizonal className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


