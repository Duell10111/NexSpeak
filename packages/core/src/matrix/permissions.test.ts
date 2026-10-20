import { describe, expect, it } from 'vitest'
import {
  applyPermissionLevels,
  changedPermissions,
  forbiddenPermissionChange,
  readPermissionLevels,
  roleForThreshold,
  samePermissionLevels,
} from './permissions'
import { CALL_MEMBER_EVENT_TYPE } from './rtc'

const DEFAULTS = {
  users: { '@alice:example.org': 100 },
  users_default: 0, events_default: 0, state_default: 50,
  ban: 50, kick: 50, redact: 50, invite: 0,
  events: { 'm.room.power_levels': 100, [CALL_MEMBER_EVENT_TYPE]: 0, 'custom.event': 75 },
}

describe('readPermissionLevels', () => {
  it('reads explicit thresholds and falls back like the homeserver', () => {
    expect(readPermissionLevels(DEFAULTS)).toEqual({
      sendMessages: 0, joinCalls: 0, notifyEveryone: 50, invite: 0, pinMessages: 50,
      editChannel: 50, redact: 50, kick: 50, ban: 50,
    })
    expect(readPermissionLevels({})).toEqual({
      sendMessages: 0, joinCalls: 50, notifyEveryone: 50, invite: 0, pinMessages: 50,
      editChannel: 50, redact: 50, kick: 50, ban: 50,
    })
  })

  it('prefers the message event over events_default and state_default for state permissions', () => {
    const levels = readPermissionLevels({
      events_default: 50, state_default: 100, notifications: { room: 0 },
      events: { 'm.room.message': 0, 'm.room.name': 50 },
    })
    expect(levels).toMatchObject({ sendMessages: 0, editChannel: 50, pinMessages: 100, joinCalls: 100, notifyEveryone: 0 })
  })

  it('uses replacements only for permissions that are not set explicitly', () => {
    expect(readPermissionLevels({ state_default: 50 }, { joinCalls: 0, kick: 0 })).toMatchObject({ joinCalls: 0, kick: 0, ban: 50 })
    expect(readPermissionLevels(DEFAULTS, { kick: 0 }).kick).toBe(50)
  })
})

describe('applyPermissionLevels', () => {
  it('writes every key of a permission and keeps roles, admin-only and custom events', () => {
    const next = applyPermissionLevels(DEFAULTS, { sendMessages: 50, editChannel: 0, notifyEveryone: 0, kick: 100 })
    expect(next).toEqual({
      ...DEFAULTS,
      events_default: 50, kick: 100,
      notifications: { room: 0 },
      events: {
        ...DEFAULTS.events,
        'm.room.message': 50, 'm.reaction': 50,
        'm.room.name': 0, 'm.room.topic': 0, 'm.room.avatar': 0,
      },
    })
    expect(readPermissionLevels(next)).toMatchObject({ sendMessages: 50, editChannel: 0, notifyEveryone: 0, kick: 100 })
    expect(DEFAULTS.events).not.toHaveProperty('m.room.message')
  })

  it('leaves the content untouched without changes', () => {
    expect(applyPermissionLevels(DEFAULTS, {})).toEqual(DEFAULTS)
  })
})

describe('comparing permissions', () => {
  it('lists only the changed thresholds', () => {
    const current = readPermissionLevels(DEFAULTS)
    const next = { ...current, ban: 100, invite: 50 }
    expect(changedPermissions(current, next)).toEqual({ ban: 100, invite: 50 })
    expect(samePermissionLevels(current, { ...current })).toBe(true)
    expect(samePermissionLevels(current, next)).toBe(false)
  })

  it('refuses thresholds above the own level, before and after the change', () => {
    const current = { ...readPermissionLevels(DEFAULTS), ban: 100 }
    expect(forbiddenPermissionChange(current, { kick: 50 }, 50)).toBeNull()
    expect(forbiddenPermissionChange(current, { kick: 100 }, 50)).toBe('kick')
    expect(forbiddenPermissionChange(current, { ban: 50 }, 50)).toBe('ban')
    expect(forbiddenPermissionChange(current, { ban: 0 }, Infinity)).toBeNull()
  })

  it('maps thresholds to roles only on an exact match', () => {
    const roles = [{ id: 'admin', level: 100 }, { id: 'moderator', level: 50 }, { id: 'member', level: 0 }]
    expect(roleForThreshold(50, roles)?.id).toBe('moderator')
    expect(roleForThreshold(75, roles)).toBeNull()
  })
})
