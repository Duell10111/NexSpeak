import { describe, expect, it } from 'vitest'
import type { Room } from 'matrix-js-sdk'
import {
  displayRole,
  levelForRoles,
  MEMBER_ROLES_EVENT,
  memberRoles,
  planRoleLevels,
  readAssignedRoleIds,
  readRoles,
  ROLES_EVENT,
  rolesContent,
} from './roles'

const ADMIN = '@admin:example.org'
const MOD = '@mod:example.org'

function space(state: Record<string, { sender: string; content: Record<string, unknown> }>, mayWrite = [ADMIN]): Room {
  return {
    currentState: {
      getStateEvents: (type: string, stateKey: string) => {
        const entry = state[`${type}|${stateKey}`]
        return entry ? { getSender: () => entry.sender, getContent: () => entry.content } : null
      },
      maySendStateEvent: (_type: string, sender: string) => mayWrite.includes(sender),
    },
  } as unknown as Room
}

const roles = (content: Record<string, unknown>, sender = ADMIN) => readRoles(space({ [`${ROLES_EVENT}|`]: { sender, content } }))

describe('readRoles', () => {
  it('has the built-in roles without any state', () => {
    expect(readRoles(null)).toEqual([
      { id: 'admin', name: '', level: 100, color: undefined, hoist: true, builtIn: true },
      { id: 'moderator', name: '', level: 50, color: undefined, hoist: true, builtIn: true },
      { id: 'member', name: '', level: 0, color: undefined, hoist: false, builtIn: true },
    ])
  })

  it('adds valid custom roles in level order and lets built-in roles change color and grouping', () => {
    const result = roles({
      roles: [
        { id: 'member', color: '#3498DB', hoist: true, level: 99, name: 'ignored' },
        { id: 'events', name: '  Event team  ', level: 25, color: '#e91e63', hoist: true },
        { id: 'stream', name: 'Streamer', level: 75 },
      ],
    })
    expect(result.map((role) => [role.id, role.level])).toEqual([['admin', 100], ['stream', 75], ['moderator', 50], ['events', 25], ['member', 0]])
    expect(result.find((role) => role.id === 'events')).toMatchObject({ name: 'Event team', color: '#e91e63', hoist: true, builtIn: false })
    expect(result.find((role) => role.id === 'member')).toMatchObject({ name: '', level: 0, color: '#3498db', hoist: true })
    expect(result.find((role) => role.id === 'stream')?.hoist).toBe(false)
  })

  it('drops invalid roles: bad levels, duplicates, missing names and unknown colors', () => {
    const result = roles({
      roles: [
        { id: 'a', name: 'A', level: 50 }, { id: 'b', name: 'B', level: 100 }, { id: 'c', name: 'C', level: 10.5 },
        { id: 'd', name: '', level: 20 }, { id: 'e', name: 'E', level: 30, color: 'red' }, { id: 'f', name: 'F', level: 30 },
        { id: 'e', name: 'E2', level: 40 }, null, 'x',
      ],
    })
    expect(result.filter((role) => !role.builtIn).map((role) => [role.id, role.level, role.color])).toEqual([['e', 30, undefined]])
  })

  it('ignores role state from senders who may not send it', () => {
    expect(roles({ roles: [{ id: 'x', name: 'X', level: 20 }] }, MOD)).toHaveLength(3)
  })

  it('round-trips through the event content', () => {
    const before = roles({ roles: [{ id: 'events', name: 'Event team', level: 25, color: '#e91e63', hoist: true }, { id: 'admin', color: '#f1c40f' }] })
    expect(roles(rolesContent(before))).toEqual(before)
  })
})

describe('assigned roles', () => {
  const custom = roles({ roles: [{ id: 'stream', name: 'Streamer', level: 75 }, { id: 'events', name: 'Events', level: 25, hoist: true, color: '#e91e63' }] })

  it('reads trusted assignments only', () => {
    const state = { [`${MEMBER_ROLES_EVENT}|user:${MOD}`]: { sender: ADMIN, content: { roles: ['events', 3, 'moderator'] } } }
    expect(readAssignedRoleIds(space(state), MOD)).toEqual(['events', 'moderator'])
    expect(readAssignedRoleIds(space(state, []), MOD)).toBeNull()
    expect(readAssignedRoleIds(space({}), MOD)).toBeNull()
  })

  it('uses the highest role as the level', () => {
    expect(levelForRoles(custom, ['events', 'moderator'])).toBe(50)
    expect(levelForRoles(custom, ['unknown'])).toBe(0)
  })

  it('shows the assigned roles while the level matches, otherwise the role of the level', () => {
    expect(memberRoles(custom, ['events', 'moderator'], 50).map((role) => role.id)).toEqual(['moderator', 'events'])
    // Changed in Element: the power level wins.
    expect(memberRoles(custom, ['events'], 100).map((role) => role.id)).toEqual(['admin'])
    expect(memberRoles(custom, null, 75).map((role) => role.id)).toEqual(['stream'])
    expect(memberRoles(custom, null, 60).map((role) => role.id)).toEqual(['moderator'])
    expect(memberRoles(custom, null, 0)).toEqual([])
    expect(memberRoles(custom, null, Infinity).map((role) => role.id)).toEqual(['admin'])
  })

  it('groups by the highest separate role and colors by the highest colored one', () => {
    const shown = memberRoles(custom, ['stream', 'events'], 75)
    expect(displayRole(shown)).toEqual({ hoisted: shown[1], color: '#e91e63' })
    expect(displayRole([])).toEqual({ hoisted: null, color: undefined })
  })
})

describe('planRoleLevels', () => {
  const order = (...ids: Array<string | [string, number]>) =>
    ids.map((entry) => (typeof entry === 'string' ? { id: entry } : { id: entry[0], level: entry[1] }))

  it('keeps levels that are still in order and puts new roles in the middle of the gap', () => {
    expect(planRoleLevels(order('admin', ['a', 75], 'moderator', 'new', ['b', 25], 'member'))).toEqual(new Map([['a', 75], ['new', 38], ['b', 25]]))
    expect(planRoleLevels(order('admin', 'moderator', 'new', 'member'))).toEqual(new Map([['new', 25]]))
  })

  it('moves only the role that changed position', () => {
    // b moved above a.
    expect(planRoleLevels(order('admin', 'moderator', ['b', 25], ['a', 38], 'member'))).toEqual(new Map([['b', 25], ['a', 13]]))
    // a moved above Moderator.
    expect(planRoleLevels(order('admin', ['a', 25], 'moderator', ['b', 38], 'member'))).toEqual(new Map([['a', 75], ['b', 38]]))
  })

  it('spreads all roles between two built-in roles when there is no gap left', () => {
    expect(planRoleLevels(order('admin', 'moderator', ['a', 2], 'new', ['b', 1], 'member'))).toEqual(new Map([['a', 38], ['new', 25], ['b', 13]]))
  })

  it('rejects invalid orders and more roles than levels', () => {
    expect(planRoleLevels(order('moderator', 'admin', 'member'))).toBeNull()
    expect(planRoleLevels(order('a', 'admin', 'moderator', 'member'))).toBeNull()
    expect(planRoleLevels(order('admin', 'moderator', 'member', 'a'))).toBeNull()
    const many = Array.from({ length: 50 }, (_, index) => `r${index}`)
    expect(planRoleLevels(order('admin', 'moderator', ...many, 'member'))).toBeNull()
    expect(planRoleLevels(order('admin', 'moderator', ...many.slice(1), 'member'))?.size).toBe(49)
  })
})
