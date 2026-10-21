import { describe, expect, it, vi } from 'vitest'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import { canManageSounds, MAX_SOUND_BYTES, parseSounds, readSounds, saveSounds, validSoundFile } from './soundboard'

const sound = { id: 'chime', name: 'Chime', emoji: '🔔', volume: 0.8, url: 'mxc://example.org/clip' }
const wireSound = { ...sound, volume: 80 }

function client(level: number, maySend = true) {
  const room = { getMember: () => ({ powerLevel: level }), currentState: { maySendStateEvent: () => maySend, getStateEvents: () => ({ getContent: () => ({ sounds: [wireSound] }) }) } } as unknown as Room
  return { getRoom: () => room, getUserId: () => '@alice:example.org', sendStateEvent: vi.fn().mockResolvedValue({}) } as unknown as MatrixClient
}

describe('server sound catalogs', () => {
  it('only accepts bounded, unique entries with Matrix media URLs', () => {
    expect(parseSounds({ sounds: [wireSound] })).toEqual([sound])
    for (const invalid of [{ ...wireSound, url: 'https://evil.test/clip.mp3' }, { ...wireSound, volume: NaN }, { ...wireSound, volume: 101 }, { ...wireSound, volume: 0.8 }, { ...wireSound, name: 'x'.repeat(33) }, { ...wireSound, id: 'default:chime' }]) {
      expect(parseSounds({ sounds: [invalid] })).toEqual([])
    }
    expect(parseSounds({ sounds: [wireSound, wireSound] })).toEqual([sound])
    expect(parseSounds(null)).toEqual([])
  })

  it('allows editing only for moderators authorized for the state event', async () => {
    expect(canManageSounds(client(0), '!server')).toBe(false)
    expect(canManageSounds(client(50), '!server')).toBe(true)
    expect(canManageSounds(client(100, false), '!server')).toBe(false)
    const member = client(0)
    await expect(saveSounds(member, '!server', [sound])).rejects.toThrow('moderator')
    expect(member.sendStateEvent).not.toHaveBeenCalled()
    const moderator = client(50)
    await saveSounds(moderator, '!server', [sound])
    expect(moderator.sendStateEvent).toHaveBeenCalledWith('!server', 'io.nexspeak.soundboard', { sounds: [wireSound] }, '')
    await expect(saveSounds(moderator, '!server', [sound, sound])).rejects.toThrow('Invalid')
    await expect(saveSounds(moderator, '!server', [{ ...sound, volume: 2 }])).rejects.toThrow('Invalid')
  })

  it('retains an authorized catalog if its uploader is later demoted', () => {
    expect(readSounds(client(0).getRoom('!server'))).toEqual([sound])
  })

  it('rejects oversized, too-long or unsupported recordings before upload', () => {
    expect(validSoundFile({ size: MAX_SOUND_BYTES, type: 'audio/ogg' }, 5)).toBe(true)
    expect(validSoundFile({ size: 512, type: 'audio/mpeg' }, 1)).toBe(true)
    for (const duration of [0, -1, Infinity, NaN, 5.01]) expect(validSoundFile({ size: 512, type: 'audio/mpeg' }, duration)).toBe(false)
    expect(validSoundFile({ size: MAX_SOUND_BYTES + 1, type: 'audio/ogg' }, 1)).toBe(false)
    expect(validSoundFile({ size: 0, type: 'audio/mpeg' }, 1)).toBe(false)
    expect(validSoundFile({ size: 512, type: 'audio/wav' }, 1)).toBe(false)
  })
})
