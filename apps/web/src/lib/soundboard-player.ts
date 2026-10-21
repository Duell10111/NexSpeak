import type { MatrixClient } from 'matrix-js-sdk'
import { getMediaUrl } from '@nexspeak/core/matrix/client'
import { MAX_SOUND_BYTES, MAX_SOUND_SECONDS, type BoardSound } from '@nexspeak/core/matrix/soundboard'

/** One lazy, bounded cache per call. No downloads, audio elements or timers before first use. */
export function createSoundboardPlayer(client: MatrixClient) {
  const cache = new Map<string, Promise<HTMLAudioElement>>()
  const urls = new Set<string>()
  const controller = new AbortController()
  const playing = new Map<HTMLAudioElement, { sound: BoardSound; allowed: () => boolean }>()
  let disposed = false
  let generation = 0

  async function load(sound: BoardSound): Promise<HTMLAudioElement> {
    const remote = sound.url.startsWith('mxc://')
    const http = remote ? getMediaUrl(client, sound.url) : sound.url
    if (!http) throw new Error('Invalid sound media URL')
    const response = await fetch(http, { signal: controller.signal, ...(remote ? { headers: { Authorization: `Bearer ${client.getAccessToken() ?? ''}` } } : {}) })
    if (!response.ok) throw new Error('Sound download failed')
    if (Number(response.headers.get('Content-Length')) > MAX_SOUND_BYTES) { await response.body?.cancel(); throw new Error('Sound is too large') }
    // Bound the response even if its server omits or lies about Content-Length.
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Sound download has no body')
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let bytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > MAX_SOUND_BYTES || disposed) { await reader.cancel(); throw new Error('Sound download cancelled') }
      chunks.push(new Uint8Array(value))
    }
    if (disposed) throw new Error('Sound player disposed')
    const url = URL.createObjectURL(new Blob(chunks, { type: response.headers.get('Content-Type') || 'audio/mpeg' }))
    urls.add(url)
    const audio = new Audio()
    audio.dataset.soundboard = sound.id
    audio.preload = 'metadata'
    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => {
        audio.onloadedmetadata = null
        audio.onerror = null
        if (Number.isFinite(audio.duration) && audio.duration > 0 && audio.duration <= MAX_SOUND_SECONDS) resolve()
        else reject(new Error('Sound is longer than five seconds'))
      }
      audio.onerror = () => { audio.onloadedmetadata = null; audio.onerror = null; reject(new Error('Invalid sound audio')) }
      audio.src = url
    }).catch((error: unknown) => { URL.revokeObjectURL(url); urls.delete(url); throw error })
    if (disposed) { audio.src = ''; throw new Error('Sound player disposed') }
    return audio
  }

  return {
    async play(sound: BoardSound, volume: number, outputDeviceId: string, allowed: () => boolean = () => true) {
      if (disposed || volume <= 0) return
      const started = generation
      let ready = cache.get(sound.url)
      if (!ready) {
        ready = load(sound)
        cache.set(sound.url, ready)
        // Catalogs can change during a long call; keep memory bounded.
        if (cache.size > 36) {
          const first = cache.keys().next().value!
          const old = cache.get(first)
          cache.delete(first)
          void old?.then((audio) => { audio.pause(); URL.revokeObjectURL(audio.src); urls.delete(audio.src); audio.src = '' }).catch(() => {})
        }
      }
      try {
        const audio = await ready
        if (disposed || generation !== started || !allowed()) return
        playing.set(audio, { sound, allowed })
        audio.onended = () => playing.delete(audio)
        audio.volume = Math.max(0, Math.min(1, sound.volume * volume))
        audio.currentTime = 0
        if ('setSinkId' in audio && audio.sinkId !== outputDeviceId) await audio.setSinkId(outputDeviceId).catch(() => {})
        if (!disposed && generation === started && allowed()) await audio.play()
      } catch (error) { cache.delete(sound.url); console.warn('Failed to play soundboard audio:', error) }
    },
    refresh(volume: number, outputDeviceId: string) {
      // Pending downloads must not later play with volume/device choices captured before this update.
      generation += 1
      playing.forEach(({ sound, allowed }, audio) => {
        if (!allowed()) { audio.pause(); playing.delete(audio); return }
        audio.volume = Math.max(0, Math.min(1, sound.volume * volume))
        if ('setSinkId' in audio && audio.sinkId !== outputDeviceId) void audio.setSinkId(outputDeviceId).catch(() => {})
      })
    },
    stop() {
      generation += 1
      playing.clear()
      cache.forEach((ready) => { void ready.then((audio) => audio.pause()).catch(() => {}) })
    },
    dispose() {
      disposed = true
      controller.abort()
      generation += 1
      playing.clear()
      cache.forEach((ready) => { void ready.then((audio) => { audio.pause(); audio.src = '' }).catch(() => {}) })
      cache.clear()
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    },
  }
}
