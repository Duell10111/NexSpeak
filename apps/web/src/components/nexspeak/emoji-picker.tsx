"use client"

import { lazy, Suspense, useState, type ReactNode } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useTranslation } from "@/hooks/useTranslation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Sticker } from '@nexspeak/core/matrix/custom-emojis'

const EmojiPickerContent = lazy(() => import("./emoji-picker-content"))
const StickerPickerContent = lazy(() => import('./sticker-picker-content'))

export interface PickerCustomEmoji { name: string; url: string; key: string }
export interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  children: ReactNode
  customEmojis?: readonly PickerCustomEmoji[]
  onSelectCustom?: (emoji: PickerCustomEmoji) => void
  renderCustomEmoji?: (emoji: PickerCustomEmoji) => ReactNode
  onOpenChange?: (open: boolean) => void
  onSelectSticker?: (sticker: Sticker) => void
}

export function EmojiPicker({ children, onOpenChange, onSelectSticker, ...props }: EmojiPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('emoji')
  function changeOpen(next: boolean) {
    setOpen(next)
    onOpenChange?.(next)
  }
  const loading = <p role="status" className="p-2 text-sm">{t('emojiPicker.loading')}</p>
  const emojiContent = open && <Suspense fallback={loading}>
    <EmojiPickerContent {...props} onClose={() => changeOpen(false)} />
  </Suspense>
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-1rem)] p-2" align="end">
        {onSelectSticker ? <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full" aria-label={t('sticker.picker')}>
            <TabsTrigger value="emoji">{t('sticker.emojiTab')}</TabsTrigger>
            <TabsTrigger value="sticker">{t('sticker.tab')}</TabsTrigger>
          </TabsList>
          <TabsContent value="emoji">{emojiContent}</TabsContent>
          <TabsContent value="sticker">{open && <Suspense fallback={loading}>
            <StickerPickerContent onSelect={(sticker) => { onSelectSticker(sticker); changeOpen(false) }} />
          </Suspense>}</TabsContent>
        </Tabs> : emojiContent}
      </PopoverContent>
    </Popover>
  )
}
