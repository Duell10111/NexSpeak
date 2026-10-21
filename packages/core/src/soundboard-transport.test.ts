import { describe, expect, it } from 'vitest'
import { SoundboardTransport } from './soundboard-transport'

const alice = '@alice:example.org:ALICE'
const bob = '@bob:example.org:BOB'
const key = () => crypto.getRandomValues(new Uint8Array(32))

function pair(encrypted = true) {
  let now = 1_000_000
  const sender = new SoundboardTransport(alice, encrypted, () => now)
  const receiver = new SoundboardTransport(bob, encrypted, () => now)
  const secret = key()
  sender.setKey(secret, 0, alice)
  receiver.setKey(secret, 0, alice)
  return { sender, receiver, advance: () => { now += 2_100 } }
}

describe('soundboard data transport', () => {
  it('encrypts triggers and authenticates the LiveKit sender', async () => {
    const { sender, receiver } = pair()
    const packet = await sender.encode('default:chime')
    expect(new TextDecoder().decode(packet)).not.toContain('default:chime')
    expect(await receiver.decode(packet, bob)).toBeNull()
    expect(await receiver.decode(packet, alice)).toBe('default:chime')
  })

  it('rejects tampering, missing keys and plaintext in encrypted calls', async () => {
    const { sender, receiver } = pair()
    const packet = await sender.encode('default:chime')
    const envelope = JSON.parse(new TextDecoder().decode(packet))
    envelope.encrypted[0] ^= 1
    expect(await receiver.decode(new TextEncoder().encode(JSON.stringify(envelope)), alice)).toBeNull()
    expect(await new SoundboardTransport(bob, true).decode(packet, alice)).toBeNull()
    const plain = await new SoundboardTransport(alice, false).encode('default:chime')
    expect(await receiver.decode(plain, alice)).toBeNull()
    await expect(new SoundboardTransport(alice, true).encode('default:chime')).rejects.toThrow('key is not ready')
  })

  it('rejects replay and rate-limits valid triggers per person across devices', async () => {
    const { sender, receiver, advance } = pair(false)
    const first = await sender.encode('default:chime')
    expect(await receiver.decode(first, alice)).toBe('default:chime')
    expect(await receiver.decode(await sender.encode('default:drum'), alice)).toBeNull()
    const secondDevice = new SoundboardTransport('@alice:example.org:PHONE', false, () => 1_000_000)
    expect(await receiver.decode(await secondDevice.encode('default:drum'), '@alice:example.org:PHONE')).toBeNull()
    advance()
    expect(await receiver.decode(first, alice)).toBeNull()
    expect(await receiver.decode(await sender.encode('default:drum'), alice)).toBe('default:drum')
  })

  it('accepts fresh key rotations and permits packets still in flight', async () => {
    const { sender, receiver, advance } = pair()
    const pending = await sender.encode('default:chime')
    const rotated = key()
    sender.setKey(rotated, 1, alice)
    receiver.setKey(rotated, 1, alice)
    expect(await receiver.decode(pending, alice)).toBe('default:chime')
    advance()
    expect(await receiver.decode(await sender.encode('default:drum'), alice)).toBe('default:drum')
    receiver.forget(alice)
    advance()
    expect(await receiver.decode(await sender.encode('default:drum'), alice)).toBeNull()
  })

  it('rejects oversized, malformed, invalid IDs and stale triggers', async () => {
    const { sender, receiver } = pair(false)
    expect(await receiver.decode(new Uint8Array(2049), alice)).toBeNull()
    expect(await receiver.decode(new TextEncoder().encode('null'), alice)).toBeNull()
    await expect(sender.encode('https://evil.test/clip')).rejects.toThrow('Invalid sound trigger')
    const stale = new SoundboardTransport(alice, false, () => 1)
    expect(await receiver.decode(await stale.encode('default:chime'), alice)).toBeNull()
  })

  it('drops departed participant keys and releases keys and triggers when the call ends', async () => {
    const { sender, receiver, advance } = pair()
    receiver.retain(new Set([bob]))
    expect(await receiver.decode(await sender.encode('default:chime'), alice)).toBeNull()
    const rotated = key()
    sender.setKey(rotated, 1, alice)
    receiver.setKey(rotated, 1, alice)
    expect(await receiver.decode(await sender.encode('default:chime'), alice)).toBe('default:chime')
    receiver.dispose()
    advance()
    receiver.setKey(rotated, 1, alice)
    expect(await receiver.decode(await sender.encode('default:drum'), alice)).toBeNull()
    await expect(receiver.encode('default:chime')).rejects.toThrow('disposed')
  })
})
