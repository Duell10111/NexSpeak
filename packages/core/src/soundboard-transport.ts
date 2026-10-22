/** Sound triggers use a distinct AES-GCM key derived from MatrixRTC media key material.
 * LiveKit's media E2EE does not encrypt data channels, so encrypted rooms never send plain data.
 */
import { SOUND_MIN_INTERVAL_MS } from './matrix/soundboard'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const CONTEXT = encoder.encode('io.nexspeak.soundboard.v1')
const MAX_PACKET = 2048

interface Trigger { id: string; sender: string; nonce: string; timestamp: number }
interface Envelope { index: number; iv: number[]; encrypted: number[] }

function validTrigger(value: unknown, sender: string, now: number): value is Trigger {
  if (!value || typeof value !== 'object') return false
  const trigger = value as Trigger
  return trigger.sender === sender && typeof trigger.id === 'string' && /^[\w:-]{1,64}$/.test(trigger.id) &&
    typeof trigger.nonce === 'string' && trigger.nonce.length === 36 && typeof trigger.timestamp === 'number' && Math.abs(now - trigger.timestamp) < 10_000
}

export class SoundboardTransport {
  private readonly keys = new Map<string, Map<number, Promise<CryptoKey>>>()
  private ownIndex: number | undefined
  private readonly lastPlayed = new Map<string, number>()
  private readonly seen = new Map<string, Map<string, number>>()
  private disposed = false

  constructor(private readonly ownIdentity: string, private readonly encrypted: boolean, private readonly now = Date.now) {}

  setKey(raw: Uint8Array<ArrayBuffer>, index: number, identity: string): void {
    if (this.disposed) return
    this.prune()
    let ring = this.keys.get(identity)
    if (!ring) { ring = new Map(); this.keys.set(identity, ring) }
    const derived = crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']).then((key) =>
      crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: CONTEXT, info: encoder.encode(identity) }, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']))
    ring.set(index, derived)
    // Keep only the newest few rotations, enough for an in-flight reliable packet.
    if (ring.size > 4) ring.delete(ring.keys().next().value!)
    if (identity === this.ownIdentity) this.ownIndex = index
  }

  async encode(id: string): Promise<Uint8Array<ArrayBuffer>> {
    if (this.disposed) throw new Error('Soundboard transport disposed')
    const trigger: Trigger = { id, sender: this.ownIdentity, nonce: crypto.randomUUID(), timestamp: this.now() }
    if (!validTrigger(trigger, this.ownIdentity, this.now())) throw new Error('Invalid sound trigger')
    const plaintext = encoder.encode(JSON.stringify(trigger))
    if (!this.encrypted) return plaintext
    const index = this.ownIndex
    const key = index === undefined ? undefined : this.keys.get(this.ownIdentity)?.get(index)
    if (!key) throw new Error('Soundboard encryption key is not ready')
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: CONTEXT }, await key, plaintext)
    return encoder.encode(JSON.stringify({ index, iv: [...iv], encrypted: [...new Uint8Array(ciphertext)] }))
  }

  /** sender is the identity from LiveKit, never a caller-provided payload field. */
  async decode(packet: Uint8Array, sender: string): Promise<string | null> {
    if (this.disposed || packet.byteLength > MAX_PACKET) return null
    try {
      let value: unknown = JSON.parse(decoder.decode(packet))
      if (this.encrypted) {
        const envelope = value as Envelope
        if (!envelope || !Number.isInteger(envelope.index) || !Array.isArray(envelope.iv) || envelope.iv.length !== 12 || !Array.isArray(envelope.encrypted)) return null
        const key = this.keys.get(sender)?.get(envelope.index)
        if (!key) return null
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(envelope.iv), additionalData: CONTEXT }, await key, new Uint8Array(envelope.encrypted))
        value = JSON.parse(decoder.decode(plaintext))
      }
      if (this.disposed) return null
      this.prune()
      const now = this.now()
      if (!validTrigger(value, sender, now)) return null
      const seen = this.seen.get(sender) ?? new Map<string, number>()
      if (seen.has(value.nonce)) return null
      seen.set(value.nonce, now)
      if (seen.size > 32) seen.delete(seen.keys().next().value!)
      this.seen.set(sender, seen)
      // One budget per Matrix user, including their other devices.
      const userId = sender.slice(0, sender.lastIndexOf(':'))
      const last = this.lastPlayed.get(userId)
      if (last !== undefined && now - last < SOUND_MIN_INTERVAL_MS) return null
      this.lastPlayed.set(userId, now)
      return value.id
    } catch { return null }
  }

  forget(identity: string): void {
    this.keys.delete(identity)
    // Keep recent nonces and the user rate limit through reconnects, until their freshness expires.
    this.prune()
  }

  retain(identities: Set<string>): void {
    this.keys.forEach((_ring, identity) => { if (!identities.has(identity)) this.forget(identity) })
  }

  private prune(): void {
    const now = this.now()
    this.seen.forEach((nonces, identity) => {
      nonces.forEach((time, nonce) => { if (now - time >= 10_000) nonces.delete(nonce) })
      if (nonces.size === 0) this.seen.delete(identity)
    })
    this.lastPlayed.forEach((time, user) => { if (now - time >= SOUND_MIN_INTERVAL_MS) this.lastPlayed.delete(user) })
  }

  dispose(): void {
    this.disposed = true
    this.keys.clear()
    this.seen.clear()
    this.lastPlayed.clear()
    this.ownIndex = undefined
  }
}
