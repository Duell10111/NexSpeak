"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ClientEvent, type MatrixClient, type MatrixEvent } from "matrix-js-sdk"
import type { RoomCallInfo } from "@/hooks/useRtcCallInfo"
import { IncomingCallTracker, type IncomingCall } from "@/lib/incoming-calls"

/** Reuses the existing batched MatrixRTC subscription; no additional sessions or timers. */
export function useIncomingCalls(
  client: MatrixClient | null,
  calls: Record<string, RoomCallInfo>,
  localRoomId: string,
) {
  const tracker = useMemo(() => client ? new IncomingCallTracker() : null, [client])
  const [state, setState] = useState<{ tracker: IncomingCallTracker | null; calls: IncomingCall[] }>({ tracker, calls: [] })

  useEffect(() => {
    if (!client || !tracker) return
    const refresh = () => setState({ tracker, calls: tracker.update(client, calls, localRoomId) })
    const onAccountData = (event: MatrixEvent) => {
      if (event.getType() === "m.direct" || event.getType() === "m.ignored_user_list") refresh()
    }
    refresh()
    client.on(ClientEvent.AccountData, onAccountData)
    return () => { client.off(ClientEvent.AccountData, onAccountData) }
  }, [client, calls, localRoomId, tracker])

  const dismiss = useCallback((roomId: string) => {
    tracker?.dismiss(roomId)
    setState((current) => ({ tracker, calls: current.calls.filter((call) => call.roomId !== roomId) }))
  }, [tracker])

  const retry = useCallback((roomId: string) => {
    if (!client || !tracker) return
    tracker.retry(roomId)
    setState({ tracker, calls: tracker.update(client, calls, localRoomId) })
  }, [client, tracker, calls, localRoomId])

  return { incoming: state.tracker === tracker ? state.calls[0] ?? null : null, dismiss, retry }
}
