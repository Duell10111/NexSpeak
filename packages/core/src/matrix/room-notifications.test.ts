import { describe, expect, it, vi } from "vitest"
import type { IPushRules, MatrixClient } from "matrix-js-sdk"
import { readRoomNotificationMode, setRoomNotificationMode } from "./room-notifications"

const ROOM = "!room:example.org"

function rules(partial: Partial<IPushRules["global"]>): IPushRules {
  return { global: { override: [], content: [], room: [], sender: [], underride: [], ...partial } } as IPushRules
}

const muteRule = {
  rule_id: ROOM,
  enabled: true,
  default: false,
  actions: [],
  conditions: [{ kind: "event_match", key: "room_id", pattern: ROOM }],
}

describe("readRoomNotificationMode", () => {
  it("reads the rules Element writes", () => {
    expect(readRoomNotificationMode(undefined, ROOM)).toBe("default")
    expect(readRoomNotificationMode(rules({}), ROOM)).toBe("default")
    expect(readRoomNotificationMode(rules({ override: [muteRule] } as never), ROOM)).toBe("mute")
    expect(
      readRoomNotificationMode(rules({ room: [{ rule_id: ROOM, enabled: true, default: false, actions: ["notify"] }] } as never), ROOM),
    ).toBe("all")
    expect(
      readRoomNotificationMode(rules({ room: [{ rule_id: ROOM, enabled: true, default: false, actions: [] }] } as never), ROOM),
    ).toBe("mentions")
  })

  it("ignores disabled rules and rules of other rooms", () => {
    expect(readRoomNotificationMode(rules({ override: [{ ...muteRule, enabled: false }] } as never), ROOM)).toBe("default")
    expect(readRoomNotificationMode(rules({ override: [muteRule] } as never), "!other:example.org")).toBe("default")
  })
})

describe("setRoomNotificationMode", () => {
  function client(pushRules: IPushRules) {
    return {
      pushRules,
      addPushRule: vi.fn().mockResolvedValue({}),
      deletePushRule: vi.fn().mockResolvedValue({}),
    }
  }

  it("mutes with one override rule", async () => {
    const fake = client(rules({}))
    await setRoomNotificationMode(fake as unknown as MatrixClient, ROOM, "mute")
    expect(fake.deletePushRule).not.toHaveBeenCalled()
    expect(fake.addPushRule).toHaveBeenCalledWith("global", "override", ROOM, {
      conditions: [{ kind: "event_match", key: "room_id", pattern: ROOM }],
      actions: [],
    })
  })

  it("unmutes to mentions only: removes the override, writes the room rule", async () => {
    const fake = client(rules({ override: [muteRule] } as never))
    await setRoomNotificationMode(fake as unknown as MatrixClient, ROOM, "mentions")
    expect(fake.deletePushRule).toHaveBeenCalledWith("global", "override", ROOM)
    expect(fake.addPushRule).toHaveBeenCalledWith("global", "room", ROOM, { actions: [] })
  })

  it("does nothing when the mode is already set", async () => {
    const fake = client(rules({}))
    await setRoomNotificationMode(fake as unknown as MatrixClient, ROOM, "default")
    expect(fake.addPushRule).not.toHaveBeenCalled()
    expect(fake.deletePushRule).not.toHaveBeenCalled()
  })
})
