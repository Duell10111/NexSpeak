/**
 * Discord-style permissions on top of Matrix power levels. Matrix only knows thresholds: a
 * permission is granted to everyone whose power level reaches it, so the editor offers
 * "from role X upwards". Only keys that Element shows as well are used.
 *
 * Matrix has no inheritance. A channel "follows" its category (and a category or top-level
 * channel the server) as long as all of these thresholds are equal; saving the parent then
 * writes the same values into every following room.
 */

import { EventType } from 'matrix-js-sdk'
import { CALL_MEMBER_EVENT_TYPE } from './rtc'

type Target =
  | { kind: 'level'; key: 'events_default' | 'invite' | 'kick' | 'ban' | 'redact' }
  | { kind: 'event'; type: string; state: boolean }
  | { kind: 'notification'; key: 'room' }

/** The first target is the one that is read; saving writes all of them. */
const PERMISSION_TARGETS = {
  // Encrypted messages are `m.room.encrypted`, which only `events_default` covers.
  sendMessages: [
    { kind: 'event', type: EventType.RoomMessage, state: false },
    { kind: 'level', key: 'events_default' },
    { kind: 'event', type: EventType.Reaction, state: false },
  ],
  joinCalls: [{ kind: 'event', type: CALL_MEMBER_EVENT_TYPE, state: true }],
  notifyEveryone: [{ kind: 'notification', key: 'room' }],
  invite: [{ kind: 'level', key: 'invite' }],
  pinMessages: [{ kind: 'event', type: EventType.RoomPinnedEvents, state: true }],
  editChannel: [
    { kind: 'event', type: EventType.RoomName, state: true },
    { kind: 'event', type: EventType.RoomTopic, state: true },
    { kind: 'event', type: EventType.RoomAvatar, state: true },
  ],
  redact: [{ kind: 'level', key: 'redact' }],
  kick: [{ kind: 'level', key: 'kick' }],
  ban: [{ kind: 'level', key: 'ban' }],
} as const satisfies Record<string, readonly Target[]>

export type PermissionKey = keyof typeof PERMISSION_TARGETS
export type PermissionLevels = Record<PermissionKey, number>

/** Display order of the editor. */
export const PERMISSION_KEYS = Object.keys(PERMISSION_TARGETS) as PermissionKey[]

/** A role the editor offers as a threshold. Custom roles (#32) only extend this list. */
export interface PermissionRole {
  id: string
  level: number
}

type Content = Record<string, unknown>

const numberOr = (value: unknown, fallback: number) => (typeof value === 'number' ? value : fallback)
const objectOf = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})

// Defaults of the Matrix spec for keys missing from `m.room.power_levels`.
const LEVEL_DEFAULTS = { events_default: 0, state_default: 50, invite: 0, kick: 50, ban: 50, redact: 50 }

/** The explicitly set value, without the homeserver's fallbacks. */
function explicitTarget(content: Content, target: Target): number | undefined {
  const value =
    target.kind === 'level' ? content[target.key]
    : target.kind === 'notification' ? objectOf(content.notifications)[target.key]
    : objectOf(content.events)[target.type]
  return typeof value === 'number' ? value : undefined
}

function readTarget(content: Content, target: Target): number {
  switch (target.kind) {
    case 'level':
      return numberOr(content[target.key], LEVEL_DEFAULTS[target.key])
    case 'notification':
      return numberOr(objectOf(content.notifications)[target.key], 50)
    case 'event': {
      const fallback = target.state
        ? numberOr(content.state_default, LEVEL_DEFAULTS.state_default)
        : numberOr(content.events_default, LEVEL_DEFAULTS.events_default)
      return numberOr(objectOf(content.events)[target.type], fallback)
    }
  }
}

/**
 * Thresholds of all editable permissions in `m.room.power_levels` content. `unset` replaces the
 * homeserver's fallback for permissions the content doesn't set explicitly.
 */
export function readPermissionLevels(content: Content | null | undefined, unset: Partial<PermissionLevels> = {}): PermissionLevels {
  const source = content ?? {}
  return Object.fromEntries(
    PERMISSION_KEYS.map((key) => {
      const target = PERMISSION_TARGETS[key][0]
      return [key, explicitTarget(source, target) ?? unset[key] ?? readTarget(source, target)]
    }),
  ) as PermissionLevels
}

export function changedPermissions(from: PermissionLevels, to: PermissionLevels): Partial<PermissionLevels> {
  return Object.fromEntries(PERMISSION_KEYS.filter((key) => from[key] !== to[key]).map((key) => [key, to[key]]))
}

export function samePermissionLevels(a: PermissionLevels, b: PermissionLevels): boolean {
  return PERMISSION_KEYS.every((key) => a[key] === b[key])
}

/**
 * New power level content with the changed thresholds; everything else (roles, admin-only
 * events, custom events) is kept. Never touches who may edit power levels, so a save can't
 * lock anybody out.
 */
export function applyPermissionLevels(content: Content, changes: Partial<PermissionLevels>): Content {
  const next: Content = { ...content }
  let events: Record<string, unknown> | null = null
  let notifications: Record<string, unknown> | null = null
  for (const key of PERMISSION_KEYS) {
    const value = changes[key]
    if (value === undefined) continue
    for (const target of PERMISSION_TARGETS[key] as readonly Target[]) {
      if (target.kind === 'level') {
        next[target.key] = value
      } else if (target.kind === 'notification') {
        notifications ??= { ...objectOf(content.notifications) }
        notifications[target.key] = value
      } else {
        events ??= { ...objectOf(content.events) }
        events[target.type] = value
      }
    }
  }
  if (events) next.events = events
  if (notifications) next.notifications = notifications
  return next
}

/**
 * Like the homeserver: nobody can change a threshold that is above their own level or raise
 * one above it. Returns the first permission that breaks this rule.
 */
export function forbiddenPermissionChange(
  current: PermissionLevels,
  changes: Partial<PermissionLevels>,
  ownLevel: number,
): PermissionKey | null {
  for (const key of PERMISSION_KEYS) {
    const value = changes[key]
    if (value !== undefined && (value > ownLevel || current[key] > ownLevel)) return key
  }
  return null
}

/** The role whose level is exactly this threshold, or null for a custom level. */
export function roleForThreshold<Role extends PermissionRole>(level: number, roles: readonly Role[]): Role | null {
  return roles.find((role) => role.level === level) ?? null
}
