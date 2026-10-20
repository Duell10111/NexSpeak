/**
 * Custom, stackable roles on top of Matrix power levels. Matrix knows one number per user and
 * room; everything else is client metadata in the server's space that Element ignores:
 *
 * - `io.nexspeak.roles` (state key ""): name, level, color and "show separately" of each role.
 * - `io.nexspeak.member_roles` (state key `user:` + user ID): the roles someone holds. Not the bare
 *   user ID: state keys starting with `@` belong to that user, so an admin couldn't set them.
 *
 * Someone's power level is the highest level of their roles, written into every room of the
 * server; only that is enforced by the homeserver. Admin (100), Moderator (50) and Member (0)
 * are built in, so servers without these events keep working. Custom roles sit between them and
 * their level follows their position.
 */

import type { Room } from 'matrix-js-sdk'

export const ROLES_EVENT = 'io.nexspeak.roles'
export const MEMBER_ROLES_EVENT = 'io.nexspeak.member_roles'

export function memberRolesStateKey(userId: string): string {
  return `user:${userId}`
}

export const BUILT_IN_ROLES = { admin: 100, moderator: 50, member: 0 } as const
export type BuiltInRoleId = keyof typeof BUILT_IN_ROLES

export const MAX_ROLE_NAME_LENGTH = 32
/** Discord-like swatches; anything else in the event is ignored. */
export const ROLE_COLORS = ['#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b'] as const

export interface ServerRoleInfo {
  id: string
  /** Empty for built-in roles, which are translated by the UI. */
  name: string
  level: number
  color?: string
  /** Show members with this as their highest separate role in their own group. */
  hoist: boolean
  builtIn: boolean
}

const isBuiltIn = (id: string): id is BuiltInRoleId => Object.hasOwn(BUILT_IN_ROLES, id)

type StoredRole = { id: string; name?: string; level?: number; color?: string; hoist?: boolean }

/** State is only trusted if its sender may send it now, like the homeserver would check. */
function trustedContent(space: Room | null | undefined, type: string, stateKey: string): Record<string, unknown> | null {
  const event = space?.currentState.getStateEvents(type, stateKey)
  const sender = event?.getSender()
  if (!event || !sender || !space?.currentState.maySendStateEvent(type, sender)) return null
  return event.getContent()
}

function validColor(value: unknown): string | undefined {
  return typeof value === 'string' && (ROLE_COLORS as readonly string[]).includes(value.toLowerCase()) ? value.toLowerCase() : undefined
}

/** All roles of a server, highest level first. */
export function readRoles(space: Room | null | undefined): ServerRoleInfo[] {
  const stored = trustedContent(space, ROLES_EVENT, '')?.roles
  const list = (Array.isArray(stored) ? stored : []) as StoredRole[]
  const byId = new Map(list.filter((role) => role && typeof role.id === 'string').map((role) => [role.id, role]))
  const roles: ServerRoleInfo[] = (Object.keys(BUILT_IN_ROLES) as BuiltInRoleId[]).map((id) => ({
    id,
    name: '',
    level: BUILT_IN_ROLES[id],
    color: validColor(byId.get(id)?.color),
    // Like before custom roles: admins and moderators get their own group.
    hoist: typeof byId.get(id)?.hoist === 'boolean' ? Boolean(byId.get(id)?.hoist) : id !== 'member',
    builtIn: true,
  }))
  const used = new Set<number>(Object.values(BUILT_IN_ROLES))
  for (const role of list) {
    if (!role || typeof role.id !== 'string' || isBuiltIn(role.id) || roles.some((known) => known.id === role.id)) continue
    const name = typeof role.name === 'string' ? role.name.trim().slice(0, MAX_ROLE_NAME_LENGTH) : ''
    const level = role.level
    if (!name || typeof level !== 'number' || !Number.isInteger(level) || level <= 0 || level >= 100 || used.has(level)) continue
    used.add(level)
    roles.push({ id: role.id, name, level, color: validColor(role.color), hoist: role.hoist === true, builtIn: false })
  }
  return roles.sort((a, b) => b.level - a.level)
}

/** Content of the roles event; built-in roles only store their color and grouping. */
export function rolesContent(roles: readonly ServerRoleInfo[]): Record<string, unknown> {
  return {
    roles: roles.map((role) => {
      const stored: StoredRole = role.builtIn ? { id: role.id } : { id: role.id, name: role.name.trim(), level: role.level }
      if (role.color) stored.color = role.color
      stored.hoist = role.hoist
      return stored
    }),
  }
}

/** The role IDs someone was given, or null if nobody assigned roles to them with NexSpeak. */
export function readAssignedRoleIds(space: Room | null | undefined, userId: string): string[] | null {
  const roles = trustedContent(space, MEMBER_ROLES_EVENT, memberRolesStateKey(userId))?.roles
  return Array.isArray(roles) ? roles.filter((id): id is string => typeof id === 'string') : null
}

/** The power level that results from a set of roles: the highest of them, at least Member. */
export function levelForRoles(roles: readonly ServerRoleInfo[], roleIds: readonly string[]): number {
  return Math.max(BUILT_IN_ROLES.member, ...roles.filter((role) => roleIds.includes(role.id)).map((role) => role.level))
}

/**
 * The roles to show for someone, highest first. The power level is what counts: if it was changed
 * elsewhere (Element) and no longer matches the assigned roles, show the role of that level.
 */
export function memberRoles(roles: readonly ServerRoleInfo[], assignedIds: readonly string[] | null, powerLevel: number): ServerRoleInfo[] {
  // v12+ creators have an infinite level and are admins.
  const level = Math.min(powerLevel, BUILT_IN_ROLES.admin)
  if (assignedIds) {
    const assigned = roles.filter((role) => assignedIds.includes(role.id) && role.id !== 'member')
    if (levelForRoles(roles, assigned.map((role) => role.id)) === level) return assigned
  }
  const exact = roles.find((role) => role.level === level)
  if (exact) return exact.id === 'member' ? [] : [exact]
  // A level no role has: the highest role it reaches.
  const below = roles.find((role) => role.level < level)
  return below && below.id !== 'member' ? [below] : []
}

/** Someone's group in the member list and the color of their name. */
export function displayRole(shown: readonly ServerRoleInfo[]): { hoisted: ServerRoleInfo | null; color?: string } {
  return { hoisted: shown.find((role) => role.hoist) ?? null, color: shown.find((role) => role.color)?.color }
}

type PlannedRole = { id: string; level?: number }

/** `count` levels spread evenly strictly between `above` and `below` (needs above - below > count). */
function between(above: number, below: number, count: number): number[] {
  const step = (above - below) / (count + 1)
  return Array.from({ length: count }, (_, index) => Math.round(above - (index + 1) * step))
}

function planRun(run: PlannedRole[], high: number, low: number): Map<string, number> | null {
  if (run.length > high - low - 1) return null
  // Keep every level that is still in order.
  const kept: Array<number | undefined> = []
  let previous = high
  for (const role of run) {
    const fits = role.level !== undefined && role.level < previous && role.level > low
    kept.push(fits ? role.level : undefined)
    if (fits) previous = role.level!
  }
  const levels = new Map<string, number>()
  for (let start = 0; start < run.length; ) {
    if (kept[start] !== undefined) {
      levels.set(run[start].id, kept[start]!)
      start += 1
      continue
    }
    let end = start
    while (end < run.length && kept[end] === undefined) end += 1
    const above = start === 0 ? high : kept[start - 1]!
    const below = end === run.length ? low : kept[end]!
    // No gap left: spread all roles between the two built-in roles again.
    if (above - below - 1 < end - start) {
      const spread = between(high, low, run.length)
      return new Map(run.map((role, index) => [role.id, spread[index]]))
    }
    between(above, below, end - start).forEach((level, offset) => levels.set(run[start + offset].id, level))
    start = end
  }
  return levels
}

/**
 * Levels for the custom roles in this order (highest first, built-in roles in their fixed
 * order). Every changed level rewrites power levels, so roles that are still in order keep
 * theirs; others get the middle of the gap, and only without a gap are all roles between two
 * built-in roles spread out. Null for an invalid order or more roles than levels.
 */
export function planRoleLevels(ordered: readonly PlannedRole[]): Map<string, number> | null {
  const builtIns = ordered.filter((role) => isBuiltIn(role.id)).map((role) => role.id)
  if (builtIns.join() !== 'admin,moderator,member' || ordered[0]?.id !== 'admin' || ordered.at(-1)?.id !== 'member') return null
  const levels = new Map<string, number>()
  let run: PlannedRole[] = []
  let high: number = BUILT_IN_ROLES.admin
  for (const role of ordered.slice(1)) {
    if (!isBuiltIn(role.id)) {
      run.push(role)
      continue
    }
    const low = BUILT_IN_ROLES[role.id]
    const planned = planRun(run, high, low)
    if (!planned) return null
    planned.forEach((level, id) => levels.set(id, level))
    run = []
    high = low
  }
  return levels
}
