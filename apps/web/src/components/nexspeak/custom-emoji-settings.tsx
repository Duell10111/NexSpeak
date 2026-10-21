'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMatrixClient } from '@/hooks/useMatrixClient'
import { useServerEmojis } from '@/hooks/useServerEmojis'
import { useTranslation } from '@/hooks/useTranslation'
import { CustomEmojiImage } from '@/components/nexspeak/custom-emoji-image'
import { canManageEmoji, changeServerEmoji, EMOJI_FILE_TYPES, MAX_EMOJI_BYTES, validShortcode, type CustomEmoji } from '@nexspeak/core/matrix/custom-emojis'
import { describeMatrixError } from '@nexspeak/core/matrix/errors'

function EmojiEntry({ emoji, disabled, busy, onRename, onDelete }: {
  emoji: CustomEmoji; disabled: boolean; busy: boolean; onRename: (name: string) => void; onDelete: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(emoji.name)
  return (
    <div className="flex items-center gap-2 rounded border border-border p-2">
      <CustomEmojiImage mxc={emoji.url} name={`:${emoji.name}:`} size={32} />
      <Input value={name} onChange={(event) => setName(event.target.value)} disabled={disabled || busy}
        maxLength={100} aria-label={t('customEmoji.rename', { name: emoji.name })} className="min-w-0 flex-1" />
      {!disabled && <>
        <Button size="sm" variant="outline" disabled={busy || name === emoji.name || !validShortcode(name)} onClick={() => onRename(name)}>{t('common.save')}</Button>
        <Button size="sm" variant="destructive" disabled={busy} onClick={onDelete} aria-label={t('customEmoji.delete', { name: emoji.name })}>{t('common.delete')}</Button>
      </>}
    </div>
  )
}

export function CustomEmojiSettings({ serverId }: { serverId: string }) {
  const { client } = useMatrixClient()
  const { t } = useTranslation()
  const [usage, setUsage] = useState<'emoticon' | 'sticker'>('emoticon')
  const emojis = useServerEmojis(true, serverId, usage)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const canEdit = Boolean(client && canManageEmoji(client, serverId))
  const action = async (work: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try { await work() } catch (error) { toast.error(describeMatrixError(error, t('customEmoji.failed'))) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const upload = (file: File) => {
    if (!client || !canEdit) return
    if (!EMOJI_FILE_TYPES.split(',').includes(file.type) || file.size > MAX_EMOJI_BYTES) {
      toast.error(t('customEmoji.invalidFile')); return
    }
    if (!validShortcode(name) || emojis.some((emoji) => emoji.name === name)) {
      toast.error(t('customEmoji.invalidName')); return
    }
    void action(async () => {
      // Other clients size stickers from info.w/h; reading them once at upload is cheap.
      const bitmap = await createImageBitmap(file)
      const info = { mimetype: file.type, size: file.size, w: bitmap.width, h: bitmap.height }
      bitmap.close()
      const { content_uri: url } = await client.uploadContent(file, { type: file.type, includeFilename: false })
      await changeServerEmoji(client, serverId, { name, image: { url, usage: [usage], info } })
      setName('')
    })
  }
  return (
    <section className="space-y-3" aria-label={t('customEmoji.title')}>
      <Tabs value={usage} onValueChange={(value) => setUsage(value as 'emoticon' | 'sticker')}>
        <TabsList aria-label={t('sticker.manage')}>
          <TabsTrigger value="emoticon">{t('sticker.emojiTab')}</TabsTrigger>
          <TabsTrigger value="sticker">{t('sticker.tab')}</TabsTrigger>
        </TabsList>
        <TabsContent value={usage} className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('customEmoji.description')}</p>
          {usage === 'sticker' && <p className="text-sm text-muted-foreground">{t('sticker.manageHint')}</p>}
          {!canEdit && <p className="text-sm text-muted-foreground">{t('customEmoji.readOnly')}</p>}
          {canEdit && <div className="space-y-2">
            <Label htmlFor="emoji-shortcode">{t(usage === 'sticker' ? 'sticker.name' : 'customEmoji.shortcode')}</Label>
            <div className="flex gap-2">
              <Input id="emoji-shortcode" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="party_cat" disabled={busy} />
              <Button variant="outline" disabled={busy || !validShortcode(name)} onClick={() => fileRef.current?.click()}>{t(usage === 'sticker' ? 'sticker.upload' : 'customEmoji.upload')}</Button>
            </div>
            <p className="text-xs text-muted-foreground">{t(usage === 'sticker' ? 'sticker.fileHint' : 'customEmoji.fileHint')}</p>
            <input ref={fileRef} type="file" accept={EMOJI_FILE_TYPES} className="hidden" aria-label={t(usage === 'sticker' ? 'sticker.upload' : 'customEmoji.upload')} onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) upload(file)
            }} />
          </div>}
          {!emojis.length && <p className="text-sm text-muted-foreground">{t(usage === 'sticker' ? 'sticker.serverEmpty' : 'customEmoji.empty')}</p>}
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
            {emojis.map((emoji) => <EmojiEntry key={`${emoji.packId}:${emoji.name}`} emoji={emoji} disabled={!canEdit} busy={busy}
              onRename={(next) => void action(() => changeServerEmoji(client!, serverId, { packId: emoji.packId, oldName: emoji.name, name: next }))}
              onDelete={() => void action(() => changeServerEmoji(client!, serverId, { packId: emoji.packId, oldName: emoji.name, usage }))} />)}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}
