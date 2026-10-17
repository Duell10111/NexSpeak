/**
 * useReadReceipt Hook
 * Marks the latest message of the open room as read while the window is focused,
 * so unread badges clear here and on the user's other devices.
 */

'use client'

import { useEffect } from 'react'
import { ReceiptType, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'

export function useReadReceipt(
  client: MatrixClient | null,
  roomId: string,
  latestEvent: MatrixEvent | undefined,
  enabled: boolean,
): void {
  const latestEventId = latestEvent?.getId()

  useEffect(() => {
    if (!client || !roomId || !latestEvent || !latestEventId || !enabled) return
    // Local echoes have temporary ids that the server doesn't know about.
    if (latestEventId.startsWith('~') || latestEvent.status !== null) return

    const send = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return

      const room = client.getRoom(roomId)
      const userId = client.getUserId()
      if (!room || !userId || room.hasUserReadEvent(userId, latestEventId)) return

      client.sendReadReceipt(latestEvent, ReceiptType.Read).catch((error: unknown) => {
        console.warn('Failed to send read receipt:', error)
      })
    }

    send()
    window.addEventListener('focus', send)
    document.addEventListener('visibilitychange', send)
    return () => {
      window.removeEventListener('focus', send)
      document.removeEventListener('visibilitychange', send)
    }
  }, [client, roomId, latestEvent, latestEventId, enabled])
}
