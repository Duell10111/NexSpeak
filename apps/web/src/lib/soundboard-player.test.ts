import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSoundboardPlayer } from './soundboard-player'

const sound = { id: 'clip', name: 'Clip', emoji: '🔊', volume: 1, url: '/sounds/chime.mp3' }

function setup() {
  let completeMetadata: (() => void) | undefined
  const play = vi.fn().mockResolvedValue(undefined)
  const pause = vi.fn()
  class FakeAudio {
    dataset = {}
    volume = 1
    currentTime = 0
    duration = 1
    preload = ''
    onloadedmetadata: (() => void) | null = null
    onerror: (() => void) | null = null
    onended: (() => void) | null = null
    private source = ''
    set src(value: string) { this.source = value; if (value) completeMetadata = () => this.onloadedmetadata?.() }
    get src() { return this.source }
    play = play
    pause = pause
  }
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } })))
  const player = createSoundboardPlayer({} as Parameters<typeof createSoundboardPlayer>[0])
  return { player, play, pause, metadata: async () => { await vi.waitFor(() => expect(completeMetadata).toBeDefined()); completeMetadata!() } }
}

afterEach(() => vi.unstubAllGlobals())

describe('lazy call soundboard playback', () => {
  it('does no work before playback and drops a pending sound when volume changes', async () => {
    const { player, play, metadata } = setup()
    expect(fetch).not.toHaveBeenCalled()
    const pending = player.play(sound, 1, '')
    await metadata()
    player.refresh(0, '')
    await pending
    expect(play).not.toHaveBeenCalled()
    player.dispose()
  })

  it('rechecks ignore/deafen permission after a download and releases the call cache', async () => {
    const { player, play, metadata } = setup()
    let allowed = true
    const pending = player.play(sound, 1, '', () => allowed)
    allowed = false
    await metadata()
    await pending
    expect(play).not.toHaveBeenCalled()
    allowed = true
    await player.play(sound, 0.5, '', () => allowed)
    expect(play).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledOnce()
    player.dispose()
    await player.play(sound, 1, '')
    expect(play).toHaveBeenCalledOnce()
  })
})
