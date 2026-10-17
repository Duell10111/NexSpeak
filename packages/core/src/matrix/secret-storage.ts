/**
 * Secret storage key handling (the user's recovery key).
 * The SDK asks for the key through callbacks whenever it needs to read or write secrets
 * (cross-signing keys, key backup key). We only hand out a key the user entered or
 * created in this session and keep it in memory just for the running operation.
 */

import type { CryptoCallbacks } from 'matrix-js-sdk/lib/crypto-api'

let cachedKey: { keyId: string | null; key: Uint8Array<ArrayBuffer> } | null = null

export const secretStorageCallbacks: CryptoCallbacks = {
  getSecretStorageKey: async ({ keys }) => {
    if (!cachedKey) return null
    const keyId = cachedKey.keyId && keys[cachedKey.keyId] ? cachedKey.keyId : Object.keys(keys)[0]
    return keyId ? [keyId, cachedKey.key] : null
  },
  cacheSecretStorageKey: (keyId, _keyInfo, key) => {
    cachedKey = { keyId, key }
  },
}

/** Run an operation that needs secret storage with the given key, then forget the key. */
export async function withSecretStorageKey<T>(
  key: Uint8Array<ArrayBuffer>,
  keyId: string | null,
  operation: () => Promise<T>,
): Promise<T> {
  cachedKey = { keyId, key }
  try {
    return await operation()
  } finally {
    cachedKey = null
  }
}

export function forgetSecretStorageKey(): void {
  cachedKey = null
}
