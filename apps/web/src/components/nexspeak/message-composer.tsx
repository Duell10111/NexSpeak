"use client"

import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react"
import { AtSign, Hash, PlusCircle, SendHorizonal, Smile, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Spinner } from "@/components/ui/spinner"
import { EmojiPicker } from "@/components/nexspeak/emoji-picker"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { Trans, useTranslation } from "@/hooks/useTranslation"
import {
  findMentionTrigger,
  roomCandidates,
  ROOM_MENTION,
  userCandidates,
  type MentionCandidate,
} from "@nexspeak/core/matrix/mentions"
import type { MessageMention } from "@nexspeak/core/matrix/messages"

const MAX_COMPOSER_HEIGHT_PX = 200

export interface ComposedMessage {
  body: string
  mentions: MessageMention[]
  mentionsRoom: boolean
}

export interface MessageComposerHandle {
  focus: () => void
}

interface MessageComposerProps {
  roomId: string
  placeholder: string
  disabled: boolean
  /** Shown above the input while replying. */
  replyToName?: string
  onCancelReply?: () => void
  onSend: (message: ComposedMessage) => void
  onFiles?: (files: File[]) => void
  isUploading?: boolean
  attachLabel?: string
  /** Arrow up in an empty composer (edit the last own message, like Discord). */
  onEditLast?: () => boolean
  onTyping?: (isTyping: boolean) => void
  onStopTyping?: () => void
  compact?: boolean
}

interface Suggestions {
  start: number
  end: number
  candidates: MentionCandidate[]
  selected: number
}

function MentionSuggestions({
  suggestions,
  onPick,
  onHover,
}: {
  suggestions: Suggestions
  onPick: (candidate: MentionCandidate) => void
  onHover: (index: number) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="absolute right-0 bottom-full left-0 z-30 mb-2 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg"
      role="listbox"
      aria-label={t("mentions.suggestions")}
    >
      {suggestions.candidates.map((candidate, index) => (
        <button
          key={candidate.id}
          type="button"
          role="option"
          aria-selected={index === suggestions.selected}
          // Keep the focus in the textarea.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(candidate)}
          onMouseEnter={() => onHover(index)}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
            index === suggestions.selected ? "bg-nx-hover text-foreground" : "text-muted-foreground",
          )}
        >
          {candidate.kind === "user" ? (
            <MatrixAvatar mxcUrl={candidate.avatarMxc} name={candidate.label} size={24} className="text-[10px]" />
          ) : candidate.kind === "room" ? (
            <Hash className="h-5 w-5 shrink-0" />
          ) : (
            <AtSign className="h-5 w-5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {candidate.kind === "everyone" ? t("mentions.everyone") : candidate.label}
          </span>
          {candidate.detail && <span className="max-w-[45%] shrink-0 truncate text-xs">{candidate.detail}</span>}
        </button>
      ))}
    </div>
  )
}

/** The message input with mention autocompletion, emoji and attachments; shared by chat and threads. */
export const MessageComposer = forwardRef<MessageComposerHandle, MessageComposerProps>(function MessageComposer(
  {
    roomId,
    placeholder,
    disabled,
    replyToName,
    onCancelReply,
    onSend,
    onFiles,
    isUploading = false,
    attachLabel,
    onEditLast,
    onTyping,
    onStopTyping,
    compact = false,
  },
  ref,
) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const [value, setValue] = useState("")
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null)
  // Mentions picked from the suggestions; only those still in the text count when sending.
  const mentionsRef = useRef<MentionCandidate[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const membersRequestedRef = useRef(false)
  // Caret for text we inserted ourselves; set right after the commit, before the next keystroke
  // can land in between (a later frame would move the caret back in front of it).
  const pendingCaretRef = useRef<number | null>(null)

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), [])

  const resize = () => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT_PX)}px`
  }

  useLayoutEffect(() => {
    const caret = pendingCaretRef.current
    const element = textareaRef.current
    if (caret === null || !element) return
    pendingCaretRef.current = null
    element.focus()
    element.setSelectionRange(caret, caret)
    resize()
  }, [value])

  /** Only computed while a trigger is typed; nothing runs for normal text. */
  const updateSuggestions = (text: string, caret: number) => {
    const trigger = findMentionTrigger(text, caret)
    const room = client?.getRoom(roomId)
    if (!trigger || !client || !room) {
      setSuggestions(null)
      return
    }
    if (trigger.trigger === "@" && !membersRequestedRef.current) {
      // With lazy loading the member list may be incomplete; load it once, on first use.
      membersRequestedRef.current = true
      room
        .loadMembersIfNeeded()
        .then(() => {
          const element = textareaRef.current
          if (element) updateSuggestions(element.value, element.selectionStart)
        })
        .catch(() => {})
    }
    const candidates =
      trigger.trigger === "@" ? userCandidates(client, room, trigger.query) : roomCandidates(client, trigger.query)
    setSuggestions(candidates.length > 0 ? { start: trigger.start, end: caret, candidates, selected: 0 } : null)
  }

  const pick = (candidate: MentionCandidate) => {
    if (!suggestions) return
    const insert = `${candidate.text} `
    const next = value.slice(0, suggestions.start) + insert + value.slice(suggestions.end)
    const caret = suggestions.start + insert.length
    if (candidate.kind !== "everyone") mentionsRef.current = [...mentionsRef.current, candidate]
    pendingCaretRef.current = caret
    setValue(next)
    setSuggestions(null)
  }

  const send = () => {
    const body = value.trim()
    if (!body || disabled) return
    const mentions = mentionsRef.current.filter((mention) => body.includes(mention.text))
    const mayNotifyRoom = Boolean(
      client && client.getRoom(roomId)?.currentState.mayTriggerNotifOfType("room", client.getUserId() ?? ""),
    )
    onSend({ body, mentions, mentionsRoom: mayNotifyRoom && new RegExp(`(^|\\s)${ROOM_MENTION}(?!\\w)`).test(body) })
    mentionsRef.current = []
    setValue("")
    setSuggestions(null)
    onStopTyping?.()
    requestAnimationFrame(resize)
  }

  const insertEmoji = (emoji: string) => {
    const element = textareaRef.current
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? value.length
    pendingCaretRef.current = start + emoji.length
    setValue(value.slice(0, start) + emoji + value.slice(end))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return

    if (suggestions) {
      const count = suggestions.candidates.length
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const delta = event.key === "ArrowDown" ? 1 : -1
        setSuggestions({ ...suggestions, selected: (suggestions.selected + delta + count) % count })
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        pick(suggestions.candidates[suggestions.selected])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setSuggestions(null)
        return
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      send()
    } else if (event.key === "Escape" && replyToName) {
      onCancelReply?.()
    } else if (event.key === "ArrowUp" && !value && onEditLast?.()) {
      event.preventDefault()
    }
  }

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value)
    onTyping?.(event.target.value.length > 0)
    updateSuggestions(event.target.value, event.target.selectionStart)
    resize()
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0 || !onFiles) return
    event.preventDefault()
    onFiles(files)
  }

  return (
    <div className="relative">
      {suggestions && (
        <MentionSuggestions
          suggestions={suggestions}
          onPick={pick}
          onHover={(index) => setSuggestions({ ...suggestions, selected: index })}
        />
      )}
      {replyToName && (
        <div className="flex items-center justify-between gap-2 rounded-t-lg bg-secondary px-4 py-2 text-sm text-muted-foreground">
          <span className="truncate">
            <Trans k="chat.replyingTo" values={{ name: <span className="font-semibold text-foreground">{replyToName}</span> }} />
          </span>
          <button
            onClick={onCancelReply}
            className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={t("chat.cancelReply")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className={cn("flex items-start gap-1 bg-nx-chat-input pr-2 pl-1", replyToName ? "rounded-b-lg" : "rounded-lg", compact && "pl-0")}>
        {onFiles && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  aria-label={t("chat.attachFile")}
                  disabled={disabled || isUploading}
                >
                  {isUploading ? <Spinner className="h-5 w-5" /> : <PlusCircle className="h-6 w-6" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{attachLabel ?? t("chat.attachFile")}</TooltipContent>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ""
                if (files.length > 0) onFiles(files)
              }}
            />
          </>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onSelect={(event) => suggestions && updateSuggestions(event.currentTarget.value, event.currentTarget.selectionStart)}
          onBlur={() => {
            setSuggestions(null)
            onStopTyping?.()
          }}
          placeholder={placeholder}
          aria-label={t("chat.message")}
          aria-autocomplete="list"
          className={cn(
            "max-h-[200px] min-w-0 flex-1 resize-none bg-transparent py-[11px] text-[15px] leading-[22px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50",
            !onFiles && "pl-3",
          )}
          disabled={disabled}
        />
        <div className="flex h-11 shrink-0 items-center gap-1">
          <EmojiPicker onSelect={insertEmoji}>
            <button
              className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              aria-label={t("chat.insertEmoji")}
              disabled={disabled}
            >
              <Smile className="h-6 w-6" />
            </button>
          </EmojiPicker>
          {value.trim() && (
            <button
              onClick={send}
              disabled={disabled}
              className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              aria-label={t("chat.send")}
            >
              <SendHorizonal className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
