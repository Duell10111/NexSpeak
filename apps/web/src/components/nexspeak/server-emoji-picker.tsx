'use client'

import { useState, type ReactNode } from 'react'
import { EmojiPicker } from '@/components/nexspeak/emoji-picker'
import { CustomEmojiImage } from '@/components/nexspeak/custom-emoji-image'
import { useServerEmojis } from '@/hooks/useServerEmojis'
import type { Sticker } from '@nexspeak/core/matrix/custom-emojis'

/** All picker instances stay cheap until opened, including one per message action bar. */
export function ServerEmojiPicker({ onSelect, onSelectCustom, onSelectSticker, children }: {
  onSelect: (emoji: string) => void
  onSelectCustom?: (emoji: { name: string; url: string; key: string }) => void
  onSelectSticker?: (sticker: Sticker) => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const emojis = useServerEmojis(open)
  return <EmojiPicker onSelect={onSelect} onOpenChange={setOpen} customEmojis={emojis}
    onSelectSticker={onSelectSticker}
    onSelectCustom={onSelectCustom ?? ((emoji) => onSelect(emoji.key))}
    renderCustomEmoji={(emoji) => <CustomEmojiImage mxc={emoji.url} name={`:${emoji.name}:`} size={24} />}>
    {children}
  </EmojiPicker>
}
