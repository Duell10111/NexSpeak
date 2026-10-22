"use client"

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { ChevronDown, Music2, Search, Volume2, VolumeX } from "lucide-react"
import { callSounds, DEFAULT_SOUNDS, soundboardServer, subscribeSounds, type BoardSound } from "@nexspeak/core/matrix/soundboard"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useCallContext } from "@/components/nexspeak/call-context"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { getDefaultAudioSettings, loadAudioSettings, saveAudioSettings, subscribeAudioSettings } from "@/lib/audio-settings"
import { cn } from "@/lib/utils"
import type { MessageKey } from "@nexspeak/i18n"

const DEFAULT_LABELS: Record<string, MessageKey> = {
  'default:celebrate': 'soundboard.celebrate',
  'default:chime': 'soundboard.chime',
  'default:drum': 'soundboard.drum',
}

interface Section { key: string; title: string; icon: ReactNode; sounds: { sound: BoardSound; label: string }[] }

function SoundGrid({ roomId }: { roomId: string }) {
  const { client } = useMatrixClient()
  const { t } = useTranslation()
  const { playSound, isDeafened } = useCallContext()
  const settings = useSyncExternalStore(subscribeAudioSettings, loadAudioSettings, getDefaultAudioSettings)
  const [, update] = useState(0)
  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [showVolume, setShowVolume] = useState(false)
  // A ref, not state: toggling `disabled` for the few milliseconds a send takes makes every button flicker.
  const sending = useRef(false)
  const serverId = client ? soundboardServer(client, roomId) : null
  useEffect(() => {
    if (client && serverId) return subscribeSounds(client, serverId, () => update((value) => value + 1))
  }, [client, serverId])

  const server = serverId ? client?.getRoom(serverId) : null
  const label = (sound: BoardSound) => DEFAULT_LABELS[sound.id] ? t(DEFAULT_LABELS[sound.id]) : sound.name
  const needle = query.trim().toLocaleLowerCase()
  const matching = (sounds: readonly BoardSound[]) => sounds
    .map((sound) => ({ sound, label: label(sound) }))
    .filter((item) => !needle || item.label.toLocaleLowerCase().includes(needle))
  const all = client ? callSounds(client, roomId) : []
  const sections: Section[] = [
    {
      key: "server",
      title: server?.name ?? "",
      icon: <MatrixAvatar mxcUrl={server?.getMxcAvatarUrl()} name={server?.name ?? ""} size={18} />,
      sounds: matching(all.filter((sound) => !sound.id.startsWith("default:"))),
    },
    { key: "default", title: t("soundboard.defaults"), icon: <Music2 className="h-4 w-4" aria-hidden />, sounds: matching(DEFAULT_SOUNDS) },
  ].filter((section) => section.sounds.length > 0)

  const play = (id: string) => {
    if (sending.current) return
    sending.current = true
    void playSound(id).finally(() => { sending.current = false })
  }
  const muted = !settings.soundboardEnabled || settings.soundboardVolume === 0

  return (
    <div className="flex max-h-[min(28rem,70vh)] flex-col gap-3">
      <div className="flex items-center gap-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("soundboard.search")}
            aria-label={t("soundboard.search")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        <button
          type="button"
          aria-label={t("soundboard.volume")}
          title={t("soundboard.volume")}
          aria-expanded={showVolume}
          onClick={() => setShowVolume((value) => !value)}
          className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground", showVolume && "bg-accent text-foreground")}
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      </div>
      {showVolume && (
        <div className="flex items-center gap-3 rounded-md bg-muted/60 px-3 py-2">
          <input
            type="range"
            min={0}
            max={100}
            value={settings.soundboardVolume}
            disabled={!settings.soundboardEnabled}
            aria-label={t("soundboard.volume")}
            onChange={(event) => saveAudioSettings({ soundboardVolume: Number(event.target.value) })}
            className="min-w-0 flex-1"
          />
          <span className="w-10 text-right text-sm tabular-nums">{settings.soundboardVolume}%</span>
        </div>
      )}
      <div className="-mr-2 min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
        {sections.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t("soundboard.noResults")}</p>}
        {sections.map((section) => {
          const open = needle !== "" || !collapsed.has(section.key)
          return (
            <section key={section.key}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setCollapsed((current) => {
                  const next = new Set(current)
                  if (next.has(section.key)) next.delete(section.key)
                  else next.add(section.key)
                  return next
                })}
                className="mb-2 flex max-w-full items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
              >
                {section.icon}
                <span className="truncate">{section.title}</span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")} aria-hidden />
              </button>
              {open && (
                <div className="grid grid-cols-3 gap-2">
                  {section.sounds.map(({ sound, label }) => (
                    <button
                      key={sound.id}
                      type="button"
                      disabled={isDeafened}
                      title={label}
                      onClick={() => play(sound.id)}
                      className="flex h-10 min-w-0 items-center justify-center gap-2 rounded-md bg-muted px-2 text-sm font-medium transition-[background-color,transform] hover:bg-accent active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                    >
                      <span className="shrink-0 text-lg leading-none" aria-hidden>{sound.emoji}</span>
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
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
      <PopoverContent side="top" className="w-[26rem] max-w-[calc(100vw-2rem)] p-3">{call && <SoundGrid roomId={call.roomId} />}</PopoverContent>
    </Popover>
  )
}
