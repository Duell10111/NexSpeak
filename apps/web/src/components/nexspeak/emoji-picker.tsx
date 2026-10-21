"use client"

import { lazy, Suspense, useState, type ReactNode } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useTranslation } from "@/hooks/useTranslation"

const EmojiPickerContent = lazy(() => import("./emoji-picker-content"))

export interface PickerCustomEmoji { name: string; url: string; key: string }
export interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  children: ReactNode
  customEmojis?: readonly PickerCustomEmoji[]
  onSelectCustom?: (emoji: PickerCustomEmoji) => void
  renderCustomEmoji?: (emoji: PickerCustomEmoji) => ReactNode
  onOpenChange?: (open: boolean) => void
}

export function EmojiPicker({ children, onOpenChange, ...props }: EmojiPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  function changeOpen(next: boolean) {
    setOpen(next)
    onOpenChange?.(next)
  }
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-1rem)] p-2" align="end">
        {open && <Suspense fallback={<p role="status" className="p-2 text-sm">{t("emojiPicker.loading")}</p>}>
          <EmojiPickerContent {...props} onClose={() => changeOpen(false)} />
        </Suspense>}
      </PopoverContent>
    </Popover>
  )
}
