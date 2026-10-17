import { describe, expect, it } from "vitest"
import { evenOrders, isValidOrder, orderBetween, planMove, sortSpaceChildren, type SpaceChildLink } from "./space-order"

const link = (roomId: string, order?: string, ts = 0): SpaceChildLink => ({ roomId, order, ts, via: ["x"] })

describe("orderBetween", () => {
  it("finds a string strictly between two others", () => {
    for (const [a, b] of [
      ["", "b"],
      ["a", "b"],
      ["a", "a!"],
      ["az", "b"],
      ["~", null],
      ["a~~", "b"],
      ["", null],
    ] as Array<[string, string | null]>) {
      const between = orderBetween(a, b)
      expect(between, `${a} | ${b}`).not.toBeNull()
      expect(between! > a, `${between} > ${a}`).toBe(true)
      if (b !== null) expect(between! < b, `${between} < ${b}`).toBe(true)
      expect(isValidOrder(between)).toBe(true)
    }
  })

  it("gives up when nothing fits", () => {
    expect(orderBetween("a", "a")).toBeNull()
    expect(orderBetween("b", "a")).toBeNull()
    expect(orderBetween("a", "a ")).toBeNull()
  })
})

describe("evenOrders", () => {
  it("is strictly increasing and valid", () => {
    for (const count of [1, 2, 5, 94, 200]) {
      const orders = evenOrders(count)
      orders.forEach((order, index) => {
        expect(isValidOrder(order)).toBe(true)
        expect(order.endsWith(" ")).toBe(false)
        if (index > 0) expect(order > orders[index - 1]).toBe(true)
      })
    }
  })
})

describe("sortSpaceChildren", () => {
  it("puts ordered children first, then by link time and room ID", () => {
    const sorted = sortSpaceChildren([link("!d", undefined, 5), link("!c", "b"), link("!b", undefined, 1), link("!a", "a")])
    expect(sorted.map((entry) => entry.roomId)).toEqual(["!a", "!c", "!b", "!d"])
  })
})

describe("planMove", () => {
  const apply = (siblings: SpaceChildLink[], updates: Array<{ roomId: string; order: string }>) => {
    const byId = new Map(siblings.map((entry) => [entry.roomId, { ...entry }]))
    updates.forEach((update) => byId.set(update.roomId, { ...(byId.get(update.roomId) ?? link(update.roomId)), order: update.order }))
    return sortSpaceChildren([...byId.values()]).map((entry) => entry.roomId)
  }

  it("needs a single update when the neighbours are ordered", () => {
    const siblings = [link("!a", "a"), link("!b", "b"), link("!c", "c")]
    const updates = planMove(siblings, "!c", "!b")
    expect(updates).toHaveLength(1)
    expect(apply(siblings, updates)).toEqual(["!a", "!c", "!b"])
  })

  it("moves to the end and in from another parent", () => {
    const siblings = [link("!a", "a"), link("!b", "b")]
    expect(apply(siblings, planMove(siblings, "!a", null))).toEqual(["!b", "!a"])
    expect(apply(siblings, planMove(siblings, "!new", "!a"))).toEqual(["!new", "!a", "!b"])
  })

  it("renumbers children without order", () => {
    const siblings = [link("!a", undefined, 1), link("!b", undefined, 2), link("!c", undefined, 3)]
    const updates = planMove(siblings, "!c", "!a")
    expect(apply(siblings, updates)).toEqual(["!c", "!a", "!b"])
  })
})
