"use client"

import { Fragment, useState } from "react"
import { AlertCircle, Download, FileIcon, Lock, RotateCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { downloadMedia, useMediaUrl } from "@/hooks/useMediaUrl"
import { describeMatrixError } from "@/lib/matrix/errors"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import type { MatrixMessage } from "@/lib/matrix/types"

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g

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
            className="text-primary hover:underline break-all"
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
  const src = useMediaUrl(client, message.media?.mxc)
  const width = Math.min(message.media?.width || 320, 400)
  const height =
    message.media?.width && message.media?.height
      ? Math.round((message.media.height / message.media.width) * width)
      : 240

  return (
    <div
      className="mt-1 overflow-hidden rounded-lg bg-muted"
      style={{ width, height: Math.min(height, 400) }}
    >
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
    if (!client || !message.media?.mxc) return
    setIsDownloading(true)
    try {
      await downloadMedia(client, message.media.mxc, message.body)
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
        <p className="text-[11px] text-muted-foreground">{formatSize(message.media?.size)}</p>
      </div>
      <button
        onClick={() => void handleDownload()}
        disabled={isDownloading || !message.media?.mxc}
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
    case "video":
    case "audio":
    case "file":
      if (message.media?.encrypted) {
        return (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            Verschlüsselte Datei „{message.body}“ (Anzeige wird noch nicht unterstützt)
          </span>
        )
      }
      return message.kind === "image" ? <ImageAttachment message={message} /> : <FileAttachment message={message} />
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

export function MessageItem({ message, isContinuation }: { message: MatrixMessage; isContinuation: boolean }) {
  return (
    <div
      className={cn(
        "group flex gap-4 px-4 hover:bg-nx-hover/50 transition-colors",
        isContinuation ? "py-0.5" : "mt-3 py-0.5",
        message.status === "sending" && "opacity-60",
      )}
    >
      <div className="w-10 shrink-0">
        {isContinuation ? (
          <span className="invisible block pt-1 text-right text-[10px] text-muted-foreground group-hover:visible">
            {formatTime(message.timestamp)}
          </span>
        ) : (
          <MatrixAvatar mxcUrl={message.senderAvatarMxc} name={message.senderName} size={40} className="mt-0.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!isContinuation && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground" title={message.senderId}>
              {message.senderName}
            </span>
            <span className="text-[11px] text-muted-foreground">{formatTime(message.timestamp)}</span>
          </div>
        )}
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          <MessageBody message={message} />
          {message.edited && <span className="ml-1 text-[10px] text-muted-foreground">(bearbeitet)</span>}
        </div>
        {message.status === "failed" && <FailedMessageActions message={message} />}
      </div>
    </div>
  )
}

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
