"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { canManageSounds, MAX_SERVER_SOUNDS, readSounds, saveSounds, subscribeSounds, validSoundFile, type BoardSound } from "@nexspeak/core/matrix/soundboard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"

async function soundDuration(file: File): Promise<number> {
  const bytes = new Uint8Array(await file.slice(0, 96).arrayBuffer())
  const ascii = new TextDecoder().decode(bytes)
  const ogg = ascii.startsWith('OggS') && ascii.includes('OpusHead')
  const mp3 = ascii.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  if ((!ogg && !mp3) || (ogg && !['audio/ogg', 'audio/opus'].includes(file.type)) || (mp3 && !['audio/mpeg', 'audio/mp3'].includes(file.type))) throw new Error('Expected Opus/Ogg or MP3 audio')
  const url = URL.createObjectURL(file)
  const audio = new Audio()
  try {
    return await new Promise<number>((resolve, reject) => {
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => resolve(audio.duration)
      audio.onerror = () => reject(new Error('Invalid audio file'))
      audio.src = url
    })
  } finally {
    audio.onloadedmetadata = null
    audio.onerror = null
    audio.src = ''
    URL.revokeObjectURL(url)
  }
}

function SoundRow({ sound, disabled, onSave, onRemove }: { sound: BoardSound; disabled: boolean; onSave: (sound: BoardSound) => Promise<void>; onRemove: () => Promise<void> }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(sound)
  return (
    <form className="space-y-2 rounded border p-3" onSubmit={(event) => { event.preventDefault(); void onSave(draft) }}>
      <div className="flex gap-2">
        <Input aria-label={t("soundboard.emoji")} value={draft.emoji} maxLength={16} disabled={disabled} className="w-16" onChange={(event) => setDraft({ ...draft, emoji: event.target.value })} />
        <Input aria-label={t("soundboard.name")} value={draft.name} maxLength={32} required disabled={disabled} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <Button type="button" size="icon" variant="ghost" aria-label={t("soundboard.remove")} disabled={disabled} onClick={() => void onRemove()}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <div className="flex items-center gap-3">
        <Label htmlFor={`sound-volume-${sound.id}`}>{t("soundboard.volume")}</Label>
        <input id={`sound-volume-${sound.id}`} type="range" min={0} max={100} value={Math.round(draft.volume * 100)} disabled={disabled} onChange={(event) => setDraft({ ...draft, volume: Number(event.target.value) / 100 })} className="min-w-0 flex-1" />
        <span className="text-sm tabular-nums">{Math.round(draft.volume * 100)}%</span>
        <Button type="submit" size="sm" disabled={disabled || !draft.name.trim()}>{t("common.save")}</Button>
      </div>
    </form>
  )
}

export function SoundboardSettings({ serverId }: { serverId: string }) {
  const { client } = useMatrixClient()
  const { t } = useTranslation()
  const [, update] = useState(0)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => client ? subscribeSounds(client, serverId, () => update((value) => value + 1)) : undefined, [client, serverId])
  if (!client) return null
  const editable = canManageSounds(client, serverId)
  const sounds = readSounds(client.getRoom(serverId))

  async function change(action: () => Promise<void>) {
    setBusy(true)
    try { await action(); update((value) => value + 1) }
    catch (error) { console.warn('Soundboard update failed:', error); toast.error(t("soundboard.saveFailed")) }
    finally { setBusy(false) }
  }

  async function upload(file: File) {
    if (!client) return
    // Size/type first: never decode or upload a large file just to reject it later.
    if (!validSoundFile(file, 1)) { toast.error(t("soundboard.invalidFile")); return }
    setBusy(true)
    try {
      const duration = await soundDuration(file)
      if (!validSoundFile(file, duration)) { toast.error(t("soundboard.invalidFile")); return }
      if (!canManageSounds(client, serverId) || readSounds(client.getRoom(serverId)).length >= MAX_SERVER_SOUNDS) throw new Error('Soundboard limit or permissions changed')
      const result = await client.uploadContent(file, { type: file.type, name: file.name, includeFilename: false })
      const latest = readSounds(client.getRoom(serverId))
      const sound: BoardSound = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 32) || t("soundboard.title"), emoji: '🔊', volume: 0.7, url: result.content_uri }
      await saveSounds(client, serverId, [...latest, sound])
      update((value) => value + 1)
    } catch (error) { console.warn('Sound upload failed:', error); toast.error(t("soundboard.invalidFile")) }
    finally { setBusy(false) }
  }

  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="font-semibold">{t("soundboard.title")}</h3>
      <p className="text-sm text-muted-foreground">{t("soundboard.manageHint")}</p>
      {sounds.map((sound) => <SoundRow key={`${sound.id}:${sound.name}:${sound.emoji}:${sound.volume}`} sound={sound} disabled={!editable || busy} onSave={(draft) => change(() => saveSounds(client, serverId, readSounds(client.getRoom(serverId)).map((item) => item.id === draft.id ? draft : item)))} onRemove={() => change(() => saveSounds(client, serverId, readSounds(client.getRoom(serverId)).filter((item) => item.id !== sound.id)))} />)}
      {editable && <>
        <input ref={fileInput} type="file" accept="audio/ogg,audio/opus,audio/mpeg,audio/mp3,.ogg,.opus,.mp3" className="hidden" aria-label={t("soundboard.upload")} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file) }} />
        <Button type="button" variant="outline" disabled={busy || sounds.length >= MAX_SERVER_SOUNDS} onClick={() => fileInput.current?.click()}><Plus className="mr-2 h-4 w-4" />{t("soundboard.upload")}</Button>
      </>}
    </section>
  )
}
