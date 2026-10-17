"use client"

import { Fragment, memo, useState, type KeyboardEvent } from "react"
import {
  AlertCircle,
  ChevronRight,
  Copy,
  CornerUpLeft,
  Download,
  FileIcon,
  Flag,
  Lock,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RotateCw,
  SmilePlus,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { downloadMedia, useMediaUrl } from "@/hooks/useMediaUrl"
import { Trans, useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { editTextMessage, toggleReaction } from "@nexspeak/core/matrix/messages"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { EmojiPicker } from "@/components/nexspeak/emoji-picker"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { MatrixMessage } from "@nexspeak/core/matrix/types"
import { formattedLinks } from "@nexspeak/core/matrix/formatted-body"
import { FormattedMessage, LinkifiedText } from "@/components/nexspeak/formatted-message"
import { jumpToMessage } from "@/lib/jump-to-message"

export interface MessageActions {
  onReply: (message: MatrixMessage) => void
  onEditStart: (messageId: string) => void
  onEditEnd: () => void
  onDelete: (message: MatrixMessage) => void
  onReport: (message: MatrixMessage) => void
  onSetPinned: (message: MatrixMessage, pinned: boolean) => void
  /** Missing inside a thread: threads don't nest. */
  onOpenThread?: (rootId: string) => void
}

function formatTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
}

function formatSize(bytes?: number): string {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const [isDownloading, setIsDownloading] = useState(false)

  const handleDownload = async () => {
    if (!client || !message.media) return
    setIsDownloading(true)
    try {
      await downloadMedia(client, message.media, message.body)
    } catch (error) {
      toast.error(describeMatrixError(error, t("chat.downloadFailed")))
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
          {message.media?.file && <Lock className="h-3 w-3" aria-label={t("chat.encryptedFile")} />}
          {formatSize(message.media?.size)}
        </p>
      </div>
      <button
        onClick={() => void handleDownload()}
        disabled={isDownloading || !(message.media?.mxc || message.media?.file)}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label={t("chat.download")}
      >
        <Download className="h-4 w-4" />
      </button>
    </div>
  )
}

function TextBody({ message }: { message: MatrixMessage }) {
  return message.formatted ? <FormattedMessage nodes={message.formatted} /> : <LinkifiedText text={message.body} />
}

function MessageBody({ message }: { message: MatrixMessage }) {
  const { t } = useTranslation()
  switch (message.kind) {
    case "text":
      return <TextBody message={message} />
    case "notice":
      return (
        <span className="text-muted-foreground">
          <TextBody message={message} />
        </span>
      )
    case "emote":
      return (
        <span className="italic">
          * {message.senderName} <TextBody message={message} />
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
          {/* Rendered here, not taken from the cached body, so a language switch applies at once. */}
          {t(`message.${message.kind}`)}
        </span>
      )
    default:
      return <span className="text-muted-foreground">{message.body}</span>
  }
}

function ReplyPreview({ reply }: { reply: NonNullable<MatrixMessage["replyTo"]> }) {
  return (
    <button
      onClick={() => jumpToMessage(reply.eventId)}
      className="mb-0.5 flex max-w-full items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
    >
      <CornerUpLeft className="h-3 w-3 shrink-0" />
      {reply.senderName && <span className="shrink-0 font-semibold">{reply.senderName}</span>}
      <span className="truncate">{reply.body}</span>
    </button>
  )
}

/** Discord's thread bar under a message: reply count and the latest reply. */
function ThreadSummaryBar({ message, onOpen }: { message: MatrixMessage; onOpen: () => void }) {
  const { t } = useTranslation()
  const thread = message.thread
  if (!thread) return null
  const replies = thread.count === 1 ? t("thread.replyOne") : t("thread.replies", { count: thread.count })
  return (
    <button
      onClick={onOpen}
      className="mt-1 flex max-w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1 text-left text-xs hover:bg-nx-hover"
      aria-label={`${t("thread.open")}: ${replies}`}
    >
      <MessagesSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-semibold text-primary">{replies}</span>
      {thread.latestBody && (
        <span className="min-w-0 truncate text-muted-foreground">
          <span className="font-medium text-foreground">{thread.latestSenderName}</span> {thread.latestBody}
        </span>
      )}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

function Reactions({ message }: { message: MatrixMessage }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  if (message.reactions.length === 0) return null

  const react = (key: string, ownEventId?: string) => {
    if (!client) return
    toggleReaction(client, message.roomId, message.id, key, ownEventId).catch((error: unknown) => {
      toast.error(describeMatrixError(error, t("chat.reactionFailed")))
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
                "flex h-6 items-center gap-1.5 rounded-lg border px-1.5 text-sm transition-colors",
                reaction.ownEventId
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-transparent bg-secondary text-muted-foreground hover:border-muted-foreground/40",
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
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const [value, setValue] = useState(message.body)

  const save = () => {
    const body = value.trim()
    if (!client || !body || body === message.body) {
      onDone()
      return
    }
    const links = message.formatted ? formattedLinks(message.formatted) : []
    editTextMessage(client, message.roomId, message.event, body, links).catch((error: unknown) => {
      toast.error(describeMatrixError(error, t("chat.editFailed")))
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
        aria-label={t("chat.editMessage")}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        <Trans
          k="chat.editHint"
          values={{
            cancel: (
              <button className="text-primary hover:underline" onClick={onDone}>
                {t("common.cancel")}
              </button>
            ),
            save: (
              <button className="text-primary hover:underline" onClick={save}>
                {t("common.save")}
              </button>
            ),
          }}
        />
      </p>
    </div>
  )
}

function FailedMessageActions({ message }: { message: MatrixMessage }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()

  const retry = () => {
    const room = client?.getRoom(message.roomId)
    if (!client || !room) return
    client.resendEvent(message.event, room).catch((error: unknown) => {
      toast.error(describeMatrixError(error, t("chat.sendFailed")))
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
      <span>{t("chat.sendFailedShort")}</span>
      <button onClick={retry} className="inline-flex items-center gap-1 hover:underline">
        <RotateCw className="h-3 w-3" /> {t("chat.resend")}
      </button>
      <button onClick={discard} className="inline-flex items-center gap-1 hover:underline">
        <Trash2 className="h-3 w-3" /> {t("chat.discard")}
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
  isPinned: boolean
  /** Whether we may change the room's pins. */
  canPin: boolean
  actions: MessageActions
}

function MoreActions({
  message,
  isOwn,
  isPinned,
  canPin,
  actions,
  onOpenChange,
}: {
  message: MatrixMessage
  isOwn: boolean
  isPinned: boolean
  canPin: boolean
  actions: MessageActions
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const copyText = () => {
    navigator.clipboard.writeText(message.body).then(
      () => toast.success(t("common.copied")),
      () => toast.error(t("chat.copyFailed")),
    )
  }

  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("chat.moreActions")}>
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {["text", "notice", "emote"].includes(message.kind) && (
          <DropdownMenuItem onSelect={copyText}>
            <Copy className="h-4 w-4" />
            {t("chat.copyText")}
          </DropdownMenuItem>
        )}
        {canPin && (
          <DropdownMenuItem onSelect={() => actions.onSetPinned(message, !isPinned)}>
            {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {isPinned ? t("pins.unpin") : t("pins.pin")}
          </DropdownMenuItem>
        )}
        {!isOwn && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => actions.onReport(message)}>
              <Flag className="h-4 w-4" />
              {t("report.message")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const MessageItem = memo(function MessageItem({
  message,
  isContinuation,
  isOwn,
  canDelete,
  isEditing,
  isPinned,
  canPin,
  actions,
}: MessageItemProps) {
  const { t, intl } = useTranslation()
  const { client } = useMatrixClient()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const isSent = message.status === "sent"
  const isInteractive = isSent && !["redacted", "decrypting", "undecryptable"].includes(message.kind)
  const canEdit = isOwn && isInteractive && ["text", "emote"].includes(message.kind)
  const showHeader = !isContinuation || Boolean(message.replyTo)
  // Mentions and keywords (push rule "highlight"); the SDK caches the actions per event.
  const mentionsMe = !isOwn && Boolean(client?.getPushActionsForEvent(message.event)?.tweaks?.highlight)

  const react = (key: string) => {
    if (!client) return
    const existing = message.reactions.find((reaction) => reaction.key === key)
    toggleReaction(client, message.roomId, message.id, key, existing?.ownEventId).catch((error: unknown) => {
      toast.error(describeMatrixError(error, t("chat.reactionFailed")))
    })
  }

  return (
    <div
      id={`msg-${message.id}`}
      className={cn(
        "group relative flex gap-4 py-0.5 pr-12 pl-4 hover:bg-black/[0.06]",
        showHeader && "mt-[17px]",
        message.status === "sending" && "opacity-60",
        isEditing && "bg-black/[0.06]",
        mentionsMe && "border-l-2 border-nx-idle bg-nx-idle/10 pl-[14px] hover:bg-nx-idle/15",
      )}
    >
      {isInteractive && !isEditing && (
        <div
          className={cn(
            "absolute -top-4 right-4 z-10 hidden items-center rounded-md border border-nx-guild-bar bg-background p-0.5 shadow-md group-focus-within:flex group-hover:flex",
            // The open menu is portaled; keep its button (the anchor) visible meanwhile.
            isMenuOpen && "flex",
          )}
        >
          <EmojiPicker onSelect={react}>
            <button className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("chat.addReaction")}>
              <SmilePlus className="h-4 w-4" />
            </button>
          </EmojiPicker>
          <ActionButton label={t("chat.reply")} onClick={() => actions.onReply(message)}>
            <CornerUpLeft className="h-4 w-4" />
          </ActionButton>
          {actions.onOpenThread && (
            <ActionButton
              label={message.thread ? t("thread.open") : t("thread.start")}
              onClick={() => actions.onOpenThread?.(message.id)}
            >
              <MessagesSquare className="h-4 w-4" />
            </ActionButton>
          )}
          {canEdit && (
            <ActionButton label={t("chat.edit")} onClick={() => actions.onEditStart(message.id)}>
              <Pencil className="h-4 w-4" />
            </ActionButton>
          )}
          {canDelete && (
            <ActionButton label={t("common.delete")} onClick={() => actions.onDelete(message)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </ActionButton>
          )}
          <MoreActions
            message={message}
            isOwn={isOwn}
            isPinned={isPinned}
            canPin={canPin}
            actions={actions}
            onOpenChange={setIsMenuOpen}
          />
        </div>
      )}

      <div className="w-10 shrink-0">
        {showHeader ? (
          <MatrixAvatar mxcUrl={message.senderAvatarMxc} name={message.senderName} size={40} className={cn(message.replyTo ? "mt-5" : "mt-0.5")} />
        ) : (
          <span className="invisible block pt-[3px] text-right text-[11px] text-muted-foreground group-hover:visible">
            {formatTime(message.timestamp, intl)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {message.replyTo && <ReplyPreview reply={message.replyTo} />}
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="cursor-default text-[15px] leading-[22px] font-medium text-foreground hover:underline" title={message.senderId}>
              {message.senderName}
            </span>
            <span className="text-xs text-muted-foreground">{formatTime(message.timestamp, intl)}</span>
            {isPinned && <Pin className="h-3 w-3 self-center text-muted-foreground" aria-label={t("pins.pinned")} />}
          </div>
        )}
        {isEditing ? (
          <InlineEditor message={message} onDone={actions.onEditEnd} />
        ) : (
          <div className="whitespace-pre-wrap break-words text-[15px] leading-[22px] text-foreground" data-testid="message-body">
            <MessageBody message={message} />
            {message.edited && <span className="ml-1 text-[10px] text-muted-foreground">{t("chat.edited")}</span>}
          </div>
        )}
        <Reactions message={message} />
        {actions.onOpenThread && <ThreadSummaryBar message={message} onOpen={() => actions.onOpenThread?.(message.id)} />}
        {message.status === "failed" && <FailedMessageActions message={message} />}
      </div>
    </div>
  )
})

export function DateDivider({ timestamp }: { timestamp: number }) {
  const { intl } = useTranslation()
  const label = new Date(timestamp).toLocaleDateString(intl, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  return (
    <div className="mx-4 mt-6 mb-2 flex items-center gap-1" role="separator">
      <div className="h-px flex-1 bg-border" />
      <span className="px-1 text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}
