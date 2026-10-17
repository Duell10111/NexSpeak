'use client'

import { useMatrix } from '@/components/matrix-provider'

/**
 * Access the shared Matrix client. The client is owned and started by MatrixAuthProvider,
 * so calling this from many components is cheap and never starts a second sync loop.
 */
export function useMatrixClient() {
  const { client, syncState, isCryptoReady, startError } = useMatrix()
  return { client, syncState, isCryptoReady, startError }
}
