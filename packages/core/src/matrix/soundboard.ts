/** Small server sound catalogs; audio stays in Matrix media, never in the call's microphone. */
import { RoomStateEvent, type MatrixClient, type Room } from 'matrix-js-sdk'
import { getChildLinks } from './server'

export const SOUNDBOARD_EVENT = 'io.nexspeak.soundboard'
export const SOUNDBOARD_TOPIC = 'io.nexspeak.soundboard.v1'
export const MAX_SOUND_BYTES = 512 * 1024
export const MAX_SOUND_SECONDS = 5
export const MAX_SERVER_SOUNDS = 32
export const SOUND_COOLDOWN_MS = 2_000

export interface BoardSound {
  id: string
  name: string
  emoji: string
  volume: number
  url: string
}

/** Original synthesized recordings distributed with NexSpeak (see THIRD_PARTY_NOTICES.md). */
export const DEFAULT_SOUNDS: readonly BoardSound[] = [
  { id: 'default:celebrate', name: 'Celebrate', emoji: '🎉', volume: 0.6, url: '/sounds/celebrate.mp3' },
  { id: 'default:chime', name: 'Chime', emoji: '🔔', volume: 0.6, url: '/sounds/chime.mp3' },
  { id: 'default:drum', name: 'Drum', emoji: '🥁', volume: 0.6, url: '/sounds/drum.mp3' },
]

export function parseSounds(content: unknown): BoardSound[] {
  const raw = content && typeof content === 'object' ? (content as { sounds?: unknown }).sounds : null
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const sounds: BoardSound[] = []
  for (const item of raw.slice(0, MAX_SERVER_SOUNDS)) {
    if (!item || typeof item !== 'object') continue
    const sound = item as BoardSound
    if (typeof sound.id !== 'string' || !/^[\w-]{1,64}$/.test(sound.id) || seen.has(sound.id)) continue
    if (typeof sound.name !== 'string' || !sound.name.trim() || sound.name.length > 32) continue
    if (typeof sound.emoji !== 'string' || sound.emoji.length > 16) continue
    // Matrix canonical JSON only permits integers; the state stores volume as 0..100 percent.
    if (!Number.isInteger(sound.volume) || sound.volume < 0 || sound.volume > 100) continue
    if (typeof sound.url !== 'string' || !/^mxc:\/\/[^/\s]+\/[^/\s]+$/.test(sound.url)) continue
    seen.add(sound.id)
    sounds.push({ id: sound.id, name: sound.name.trim(), emoji: sound.emoji, volume: sound.volume / 100, url: sound.url })
  }
  return sounds
}

export function canManageSounds(client: MatrixClient, serverId: string): boolean {
  const room = client.getRoom(serverId)
  const userId = client.getUserId() ?? ''
  return Boolean(room && (room.getMember(userId)?.powerLevel ?? 0) >= 50 && room.currentState.maySendStateEvent(SOUNDBOARD_EVENT, userId))
}

export function readSounds(room: Room | null | undefined): BoardSound[] {
  const event = room?.currentState.getStateEvents(SOUNDBOARD_EVENT, '')
  return parseSounds(event?.getContent())
}

/** Resolve from the call room, rather than whichever server is currently being browsed. */
export function soundboardServer(client: MatrixClient, roomId: string): string | null {
  const visited = new Set<string>()
  let current = roomId
  let parent: string | undefined
  while (!visited.has(current)) {
    visited.add(current)
    parent = client.getRooms().find((room) => room.isSpaceRoom() && getChildLinks(room).some((link) => link.roomId === current))?.roomId
    if (!parent) return current === roomId ? null : current
    current = parent
  }
  return null
}

export function callSounds(client: MatrixClient, roomId: string): BoardSound[] {
  const serverId = soundboardServer(client, roomId)
  return [...DEFAULT_SOUNDS, ...readSounds(serverId ? client.getRoom(serverId) : null)]
}

export function subscribeSounds(client: MatrixClient, serverId: string, listener: () => void): () => void {
  const onState = (_event: unknown, state: { roomId: string }) => {
    if (state.roomId === serverId) listener()
  }
  client.on(RoomStateEvent.Events, onState)
  return () => { client.removeListener(RoomStateEvent.Events, onState) }
}

export async function saveSounds(client: MatrixClient, serverId: string, sounds: BoardSound[]): Promise<void> {
  if (!canManageSounds(client, serverId)) throw new Error('Soundboard management requires moderator permissions')
  if (sounds.length > MAX_SERVER_SOUNDS || sounds.some((sound) => !Number.isFinite(sound.volume) || sound.volume < 0 || sound.volume > 1)) throw new Error('Invalid sound catalog')
  const content = { sounds: sounds.map((sound) => ({ ...sound, volume: Math.round(sound.volume * 100) })) }
  if (parseSounds(content).length !== sounds.length) throw new Error('Invalid sound catalog')
  type StateSender = (roomId: string, type: string, content: { sounds: BoardSound[] }, stateKey: string) => Promise<unknown>
  await (client.sendStateEvent as unknown as StateSender).call(client, serverId, SOUNDBOARD_EVENT, content, '')
}

export function validSoundFile(file: { size: number; type: string }, duration: number): boolean {
  return file.size > 0 && file.size <= MAX_SOUND_BYTES && ['audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp3'].includes(file.type) && Number.isFinite(duration) && duration > 0 && duration <= MAX_SOUND_SECONDS
}
