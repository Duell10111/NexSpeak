'use client'

import { lazy, Suspense, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from '@/hooks/useTranslation'
import { gifApiKey, type Gif } from '@nexspeak/core/gifs'

// Nothing of the picker is loaded, and the provider is not contacted, until it is opened.
const GifPickerContent = lazy(() => import('./gif-picker-content'))

/** The composer's GIF button; hidden when the build has no provider key. */
export function GifPicker({ disabled, onSelect }: { disabled: boolean; onSelect: (gif: Gif) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!gifApiKey()) return null
  return <Popover open={open} onOpenChange={setOpen}>
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <button type="button" disabled={disabled} aria-label={t('gif.open')}
            className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
            <span aria-hidden="true" className="rounded border-2 border-current px-0.5 text-[10px] leading-3 font-extrabold">GIF</span>
          </button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent>{t('gif.open')}</TooltipContent>
    </Tooltip>
    <PopoverContent className="w-96 max-w-[calc(100vw-1rem)] p-2" align="end">
      {open && <Suspense fallback={<p role="status" className="p-2 text-sm">{t('gif.loading')}</p>}>
        <GifPickerContent onSelect={(gif) => { setOpen(false); onSelect(gif) }} />
      </Suspense>}
    </PopoverContent>
  </Popover>
}
