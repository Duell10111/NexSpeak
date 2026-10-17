/**
 * End-to-end encrypted attachments as specified in
 * https://spec.matrix.org/v1.16/client-server-api/#sending-encrypted-attachments
 * (AES-CTR-256, SHA-256 hash of the ciphertext, "v2" format as used by Element).
 */

import { t } from '@nexspeak/i18n'

export interface EncryptedFile {
  url: string
  key: {
    alg: 'A256CTR'
    ext: true
    k: string
    key_ops: string[]
    kty: 'oct'
  }
  iv: string
  hashes: Record<string, string>
  /** "v2" for files we create; older clients may have sent "v1" or nothing (v0). */
  v?: string
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of array) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function toUnpaddedBase64(bytes: ArrayBuffer | Uint8Array): string {
  return toBase64(bytes).replace(/=+$/, '')
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  // Accept unpadded and URL-safe variants, both occur in the wild.
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function isEncryptedFile(value: unknown): value is EncryptedFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<EncryptedFile>
  return (
    typeof file.url === 'string' &&
    typeof file.iv === 'string' &&
    typeof file.key?.k === 'string' &&
    typeof file.hashes?.sha256 === 'string'
  )
}

/** Encrypt file contents. The returned info lacks the url, which is known only after upload. */
export async function encryptAttachment(
  data: ArrayBuffer,
): Promise<{ ciphertext: ArrayBuffer; info: Omit<EncryptedFile, 'url'> }> {
  // 64-bit random nonce followed by a 64-bit zero counter, as required by the spec.
  const iv = new Uint8Array(16)
  crypto.getRandomValues(iv.subarray(0, 8))

  const key = await crypto.subtle.generateKey({ name: 'AES-CTR', length: 256 }, true, ['encrypt', 'decrypt'])
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-CTR', counter: iv, length: 64 }, key, data)
  const jwk = await crypto.subtle.exportKey('jwk', key)
  const sha256 = await crypto.subtle.digest('SHA-256', ciphertext)

  return {
    ciphertext,
    info: {
      key: { alg: 'A256CTR', ext: true, k: jwk.k ?? '', key_ops: ['encrypt', 'decrypt'], kty: 'oct' },
      iv: toUnpaddedBase64(iv),
      hashes: { sha256: toUnpaddedBase64(sha256) },
      v: 'v2',
    },
  }
}

/** Verify and decrypt downloaded ciphertext. Throws if the hash doesn't match. */
export async function decryptAttachment(ciphertext: ArrayBuffer, file: Omit<EncryptedFile, 'url'>): Promise<ArrayBuffer> {
  const expected = file.hashes.sha256
  const actual = toUnpaddedBase64(await crypto.subtle.digest('SHA-256', ciphertext))
  if (actual !== expected.replace(/=+$/, '')) {
    throw new Error(t('error.fileCorrupted'))
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'oct', alg: 'A256CTR', k: file.key.k, ext: true, key_ops: ['encrypt', 'decrypt'] },
    { name: 'AES-CTR', length: 256 },
    false,
    ['decrypt'],
  )
  // v1 and v2 use a 64-bit counter; only legacy v0 files (no version) used 128 bits.
  const counterLength = file.v === 'v1' || file.v === 'v2' ? 64 : 128
  return crypto.subtle.decrypt({ name: 'AES-CTR', counter: fromBase64(file.iv), length: counterLength }, key, ciphertext)
}
