/**
 * The Matrix link the user just opened (a matrix.to link in a message, or a nexspeak:// deep link
 * in the desktop app), until the part of the app that handles it is ready: the login page takes
 * SSO returns, the main view rooms and users.
 */

import type { MatrixLink } from "@nexspeak/core/matrix/links"

let pending: MatrixLink | null = null
const listeners = new Set<() => void>()

export function setPendingLink(link: MatrixLink): void {
  pending = link
  listeners.forEach((listener) => listener())
}

export function getPendingLink(): MatrixLink | null {
  return pending
}

/** Takes the link if it is one of `kinds`; the caller handles it. */
export function takePendingLink<K extends MatrixLink["kind"]>(kinds: K[]): Extract<MatrixLink, { kind: K }> | null {
  if (!pending || !kinds.includes(pending.kind as K)) return null
  const link = pending as Extract<MatrixLink, { kind: K }>
  pending = null
  listeners.forEach((listener) => listener())
  return link
}

export function subscribePendingLink(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
