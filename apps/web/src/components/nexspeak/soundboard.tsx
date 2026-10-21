"use client"

import { useEffect, useState } from "react"
import { Music2 } from "lucide-react"
import { callSounds, soundboardServer, subscribeSounds, type BoardSound } from "@nexspeak/core/matrix/soundboard"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useCallContext } from "@/components/nexspeak/call-context"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import type { MessageKey } from "@nexspeak/i18n"

const DEFAULT_LABELS: Record<string, MessageKey> = {
  'default:celebrate': 'soundboard.celebrate',
  'default:chime': 'soundboard.chime',
  'default:drum': 'soundboard.drum',
}

function SoundGrid({ roomId }: { roomId: string }) {
  const { client } = useMatrixClient()
  const { t } = useTranslation()
  const { playSound, isDeafened } = useCallContext()
  const [, update] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!client) return
    const serverId = soundboardServer(client, roomId)
    if (serverId) return subscribeSounds(client, serverId, () => update((value) => value + 1))
  }, [client, roomId])
  const sounds: readonly BoardSound[] = client ? callSounds(client, roomId) : []
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{t("soundboard.title")}</h3>
      <div className="grid max-h-72 grid-cols-3 gap-2 overflow-auto">
        {sounds.map((sound) => (
          <button key={sound.id} disabled={isDeafened || busy} className="flex min-w-0 flex-col items-center gap-1 rounded p-2 text-sm hover:bg-accent disabled:opacity-40" onClick={() => { setBusy(true); void playSound(sound.id).finally(() => setBusy(false)) }}>
            <span className="text-2xl" aria-hidden>{sound.emoji}</span>
            <span className="w-full truncate">{DEFAULT_LABELS[sound.id] ? t(DEFAULT_LABELS[sound.id]) : sound.name}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("soundboard.cooldown")}</p>
    </div>
  )
}

export function SoundboardControl() {
  const { call } = useCallContext()
  const { t } = useTranslation()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button aria-label={t("soundboard.title")} title={t("soundboard.title")} disabled={!call} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40">
          <Music2 className="h-6 w-6" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-80">{call && <SoundGrid roomId={call.roomId} />}</PopoverContent>
    </Popover>
  )
}
