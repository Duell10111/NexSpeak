"use client"

import { Fragment, memo, useState, type KeyboardEvent } from "react"
import { AlertCircle, CornerUpLeft, Download, FileIcon, Lock, Pencil, RotateCw, SmilePlus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { downloadMedia, useMediaUrl } from "@/hooks/useMediaUrl"
import { describeMatrixError } from "@/lib/matrix/errors"
import { editTextMessage, toggleReaction } from "@/lib/matrix/messages"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { EmojiPicker } from "@/components/nexspeak/emoji-picker"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { MatrixMessage } from "@/lib/matrix/types"

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g

export interface MessageActions {
  onReply: (message: MatrixMessage) => void
  onEditStart: (messageId: string) => void
  onEditEnd: () => void
  onDelete: (message: MatrixMessage) => void
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
}

function formatSize(bytes?: number): string {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN)
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-all text-primary hover:underline"
          >
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function ImageAttachment({ message }: { message: MatrixMessage }) {
  const { client } = useMatrixClient()
  const media = message.media
  // Server-side thumbnails only exist for unencrypted media.
  const src = useMediaUrl(client, media?.mxc, media?.file ? undefined : 800, media?.file, media?.mimetype)
  const width = Math.min(media?.width || 320, 400)
  const height = media?.width && media?.height ? Math.round((media.height / media.width) * width) : 240

  return (
    <div className="mt-1 max-w-full overflow-hidden rounded-lg bg-muted" style={{ width, height: Math.min(height, 400) }}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- blob: URLs cannot go through next/image
        <img src={src} alt={message.body} className="h-full w-full object-contain" />
      )}
    </div>
  )
}

function FileAttachment({ message }: { message: MatrixMessage }) {
  const { client } = useMatrixClient()
  const [isDownloading, setIsDownloading] = useState(false)

  const handleDownload = async () => {
    if (!client || !message.media) return
    setIsDownloading(true)
    try {
      await downloadMedia(client, message.media, message.body)
    } catch (error) {
      toast.error(describeMatrixError(error, "Download fehlgeschlagen."))
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="mt-1 flex max-w-sm items-center gap-3 rounded-lg border border-border bg-secondary px-3 py-2">
      <FileIcon className="h-8 w-8 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{message.body}</p>
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {message.media?.file && <Lock className="h-3 w-3" aria-label="Verschlüsselt" />}
          {formatSize(message.media?.size)}
        </p>
      </div>
      <button
        onClick={() => void handleDownload()}
        disabled={isDownloading || !(message.media?.mxc || message.media?.file)}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label="Herunterladen"
      >
        <Download className="h-4 w-4" />
      </button>
    </div>
  )
}

function MessageBody({ message }: { message: MatrixMessage }) {
  switch (message.kind) {
    case "text":
      return <LinkifiedText text={message.body} />
    case "notice":
      return (
        <span className="text-muted-foreground">
          <LinkifiedText text={message.body} />
        </span>
      )
    case "emote":
      return (
        <span className="italic">
          * {message.senderName} <LinkifiedText text={message.body} />
        </span>
      )
    case "image":
      return <ImageAttachment message={message} />
    case "video":
    case "audio":
    case "file":
      return <FileAttachment message={message} />
    case "redacted":
    case "decrypting":
    case "undecryptable":
      return (
        <span className="inline-flex items-center gap-1.5 italic text-muted-foreground">
          {message.kind === "undecryptable" && <Lock className="h-3.5 w-3.5" />}
          {message.body}
        </span>
      )
    default:
      return <span className="text-muted-foreground">{message.body}</span>
  }
}

function ReplyPreview({ reply }: { reply: NonNullable<MatrixMessage["replyTo"]> }) {
  const jumpToOriginal = () => {
    const element = document.getElementById(`msg-${reply.eventId}`)
    if (!element) return
    element.scrollIntoView({ behavior: "smooth", block: "center" })
    element.classList.add("bg-primary/10")
    setTimeout(() => element.classList.remove("bg-primary/10"), 1500)
  }

  return (
    <button
      onClick={jumpToOriginal}
      className="mb-0.5 flex max-w-full items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
    >
      <CornerUpLeft className="h-3 w-3 shrink-0" />
      {reply.senderName && <span className="shrink-0 font-semibold">{reply.senderName}</span>}
      <span className="truncate">{reply.body}</span>
    </button>
  )
}

function Reactions({ message }: { message: MatrixMessage }) {
  const { client } = useMatrixClient()
  if (message.reactions.length === 0) return null

  const react = (key: string, ownEventId?: string) => {
    if (!client) return
    toggleReaction(client, message.roomId, message.id, key, ownEventId).catch((error: unknown) => {
      toast.error(describeMatrixError(error, "Reaktion konnte nicht gesendet werden."))
    })
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {message.reactions.map((reaction) => (
        <Tooltip key={reaction.key}>
          <TooltipTrigger asChild>
            <button
              onClick={() => react(reaction.key, reaction.ownEventId)}
              className={cn(
                "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs transition-colors",
                reaction.ownEventId
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-transparent bg-muted text-muted-foreground hover:border-border",
              )}
              aria-pressed={Boolean(reaction.ownEventId)}
              aria-label={`${reaction.key} ${reaction.count}`}
            >
              <span>{reaction.key}</span>
              <span className="font-semibold">{reaction.count}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {reaction.senderIds.map((id) => client?.getRoom(message.roomId)?.getMember(id)?.name || id).join(", ")}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

function InlineEditor({ message, onDone }: { message: MatrixMessage; onDone: () => void }) {
  const { client } = useMatrixClient()
  const [value, setValue] = useState(message.body)

  const save = () => {
    const body = value.trim()
    if (!client || !body || body === message.body) {
      onDone()
      return
    }
    editTextMessage(client, message.roomId, message.event, body).catch((error: unknown) => {
      toast.error(describeMatrixError(error, "Nachricht konnte nicht bearbeitet werden."))
    })
    onDone()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      onDone()
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      save()
    }
  }

  return (
    <div className="mt-1">
      <textarea
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={(event) => event.currentTarget.setSelectionRange(value.length, value.length)}
        rows={Math.min(8, value.split("\n").length)}
        className="w-full resize-none rounded-md bg-nx-chat-input px-3 py-2 text-sm text-foreground outline-none"
        aria-label="Nachricht bearbeiten"
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        Escape zum <button className="text-primary hover:underline" onClick={onDone}>Abbrechen</button> • Enter zum{" "}
        <button className="text-primary hover:underline" onClick={save}>Speichern</button>
      </p>
    </div>
  )
}

function FailedMessageActions({ message }: { message: MatrixMessage }) {
  const { client } = useMatrixClient()

  const retry = () => {
    const room = client?.getRoom(message.roomId)
    if (!client || !room) return
    client.resendEvent(message.event, room).catch((error: unknown) => {
      toast.error(describeMatrixError(error, "Nachricht konnte nicht gesendet werden."))
    })
  }

  const discard = () => {
    try {
      client?.cancelPendingEvent(message.event)
    } catch (error) {
      console.warn("Failed to cancel pending event:", error)
    }
  }

  return (
    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-destructive">
      <AlertCircle className="h-3.5 w-3.5" />
      <span>Senden fehlgeschlagen.</span>
      <button onClick={retry} className="inline-flex items-center gap-1 hover:underline">
        <RotateCw className="h-3 w-3" /> Erneut senden
      </button>
      <button onClick={discard} className="inline-flex items-center gap-1 hover:underline">
        <Trash2 className="h-3 w-3" /> Verwerfen
      </button>
    </div>
  )
}

function ActionButton({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={label}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

interface MessageItemProps {
  message: MatrixMessage
  isContinuation: boolean
  isOwn: boolean
  canDelete: boolean
  isEditing: boolean
  actions: MessageActions
}

export const MessageItem = memo(function MessageItem({
  message,
  isContinuation,
  isOwn,
  canDelete,
  isEditing,
  actions,
}: MessageItemProps) {
  const { client } = useMatrixClient()
  const isSent = message.status === "sent"
  const isInteractive = isSent && !["redacted", "decrypting", "undecryptable"].includes(message.kind)
  const canEdit = isOwn && isInteractive && ["text", "emote"].includes(message.kind)
  const showHeader = !isContinuation || Boolean(message.replyTo)

  const react = (key: string) => {
    if (!client) return
    const existing = message.reactions.find((reaction) => reaction.key === key)
    toggleReaction(client, message.roomId, message.id, key, existing?.ownEventId).catch((error: unknown) => {
      toast.error(describeMatrixError(error, "Reaktion konnte nicht gesendet werden."))
    })
  }

  return (
    <div
      id={`msg-${message.id}`}
      className={cn(
        "group relative flex gap-4 px-4 transition-colors hover:bg-nx-hover/50",
        showHeader ? "mt-3 py-0.5" : "py-0.5",
        message.status === "sending" && "opacity-60",
        isEditing && "bg-nx-hover/50",
      )}
    >
      {isInteractive && !isEditing && (
        <div className="absolute -top-4 right-4 z-10 hidden items-center rounded-md border border-border bg-popover shadow-sm group-focus-within:flex group-hover:flex">
          <EmojiPicker onSelect={react}>
            <button className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Reaktion hinzufügen">
              <SmilePlus className="h-4 w-4" />
            </button>
          </EmojiPicker>
          <ActionButton label="Antworten" onClick={() => actions.onReply(message)}>
            <CornerUpLeft className="h-4 w-4" />
          </ActionButton>
          {canEdit && (
            <ActionButton label="Bearbeiten" onClick={() => actions.onEditStart(message.id)}>
              <Pencil className="h-4 w-4" />
            </ActionButton>
          )}
          {canDelete && (
            <ActionButton label="Löschen" onClick={() => actions.onDelete(message)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </ActionButton>
          )}
        </div>
      )}

      <div className="w-10 shrink-0">
        {showHeader ? (
          <MatrixAvatar mxcUrl={message.senderAvatarMxc} name={message.senderName} size={40} className={cn(message.replyTo ? "mt-5" : "mt-0.5")} />
        ) : (
          <span className="invisible block pt-1 text-right text-[10px] text-muted-foreground group-hover:visible">
            {formatTime(message.timestamp)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {message.replyTo && <ReplyPreview reply={message.replyTo} />}
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground" title={message.senderId}>
              {message.senderName}
            </span>
            <span className="text-[11px] text-muted-foreground">{formatTime(message.timestamp)}</span>
          </div>
        )}
        {isEditing ? (
          <InlineEditor message={message} onDone={actions.onEditEnd} />
        ) : (
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground" data-testid="message-body">
            <MessageBody message={message} />
            {message.edited && <span className="ml-1 text-[10px] text-muted-foreground">(bearbeitet)</span>}
          </div>
        )}
        <Reactions message={message} />
        {message.status === "failed" && <FailedMessageActions message={message} />}
      </div>
    </div>
  )
})

export function DateDivider({ timestamp }: { timestamp: number }) {
  const label = new Date(timestamp).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  return (
    <div className="my-4 flex items-center gap-2 px-4" role="separator">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}
