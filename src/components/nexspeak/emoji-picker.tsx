"use client"

import { useState, type ReactNode } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const EMOJIS = [
  "👍", "👎", "❤️", "😂", "😮", "😢", "😡", "🎉",
  "🔥", "👀", "✅", "❌", "🙏", "💯", "🤔", "😅",
  "😍", "🥳", "😎", "🤯", "👏", "🚀", "⭐", "💀",
  "😭", "🙌", "🤝", "💪", "🍕", "☕", "🐛", "✨",
]

export function EmojiPicker({ onSelect, children }: { onSelect: (emoji: string) => void; children: ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="end">
        <div className="grid grid-cols-8 gap-1" role="listbox" aria-label="Emoji auswählen">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                onSelect(emoji)
                setOpen(false)
              }}
              className="flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-muted"
              role="option"
              aria-selected={false}
              aria-label={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
