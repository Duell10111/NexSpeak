import { describe, expect, it } from "vitest"
import type { MatrixClient, Room } from "matrix-js-sdk"
import { IncomingCallTracker } from "./incoming-calls"
import type { RoomCallInfo } from "@/hooks/useRtcCallInfo"

const SELF = "@self:example.org"
const CALLER = "@caller:example.org"
const ROOM = "!direct:example.org"

function client({ direct = true, membership = "join", ignored = false, space = false } = {}): MatrixClient {
  const room = {
    roomId: ROOM, name: "Direct conversation", getMyMembership: () => membership,
    getDMInviter: () => undefined, isSpaceRoom: () => space,
  } as unknown as Room
  return {
    getUserId: () => SELF,
    getAccountData: () => ({ getContent: () => direct ? { [CALLER]: [ROOM] } : {} }),
    getRoom: (roomId: string) => roomId === ROOM ? room : null,
    isUserIgnored: () => ignored,
  } as unknown as MatrixClient
}

function call(...users: string[]): Record<string, RoomCallInfo> {
  return { [ROOM]: { members: users.map((userId) => ({ userId, name: userId === CALLER ? "Caller" : "Self" })) } }
}

describe("IncomingCallTracker", () => {
  it("offers joined direct message calls with the caller's name", () => {
    const tracker = new IncomingCallTracker()
    expect(tracker.update(client(), call(CALLER), "")).toEqual([
      { roomId: ROOM, roomName: "Direct conversation", callerNames: "Caller" },
    ])
  })

  it("does not prompt for channel calls, spaces, left rooms or ignored callers", () => {
    for (const options of [{ direct: false }, { space: true }, { membership: "leave" }, { ignored: true }]) {
      expect(new IncomingCallTracker().update(client(options), call(CALLER), "")).toEqual([])
    }
  })

  it("keeps declined calls dismissed across membership refreshes until everyone leaves", () => {
    const tracker = new IncomingCallTracker()
    const matrix = client()
    tracker.update(matrix, call(CALLER), "")
    tracker.dismiss(ROOM)
    expect(tracker.update(matrix, call(CALLER), "")).toEqual([])
    expect(tracker.update(matrix, call(CALLER, "@another:example.org"), "")).toEqual([])
    expect(tracker.update(matrix, {}, "")).toEqual([])
    expect(tracker.update(matrix, call(CALLER), "")).toHaveLength(1)
  })

  it("clears the prompt when the caller leaves", () => {
    const tracker = new IncomingCallTracker()
    expect(tracker.update(client(), call(CALLER), "")).toHaveLength(1)
    expect(tracker.update(client(), {}, "")).toEqual([])
  })

  it("can offer the call again after a failed local join", () => {
    const tracker = new IncomingCallTracker()
    const matrix = client()
    tracker.dismiss(ROOM)
    expect(tracker.update(matrix, call(CALLER), "")).toEqual([])
    tracker.retry(ROOM)
    expect(tracker.update(matrix, call(CALLER), "")).toHaveLength(1)
  })

  it("dismisses a call answered on another device and does not ring again when that device leaves", () => {
    const tracker = new IncomingCallTracker()
    const matrix = client()
    expect(tracker.update(matrix, call(CALLER), "")).toHaveLength(1)
    expect(tracker.update(matrix, call(CALLER, SELF), "")).toEqual([])
    expect(tracker.update(matrix, call(CALLER), "")).toEqual([])
    tracker.update(matrix, {}, "")
    expect(tracker.update(matrix, call(CALLER), "")).toHaveLength(1)
  })

  it("does not prompt for a local join before its MatrixRTC membership arrives", () => {
    const tracker = new IncomingCallTracker()
    const matrix = client()
    expect(tracker.update(matrix, call(CALLER), ROOM)).toEqual([])
    expect(tracker.update(matrix, call(CALLER, SELF), ROOM)).toEqual([])
  })

  it("can receive a different direct call while already in another call", () => {
    expect(new IncomingCallTracker().update(client(), call(CALLER), "!other:example.org")).toHaveLength(1)
  })

  it("does not ring when starting a call alone on another device", () => {
    const tracker = new IncomingCallTracker()
    const matrix = client()
    expect(tracker.update(matrix, call(SELF), "")).toEqual([])
    expect(tracker.update(matrix, call(CALLER, SELF), "")).toEqual([])
  })
})
