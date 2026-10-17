/**
 * Notification level per channel, stored as push rules on the homeserver – the same rules Element
 * writes, so both clients show the same setting:
 *
 *   default   no rule of our own: the account's defaults apply
 *   all       room rule `<room id>` with "notify"
 *   mentions  room rule `<room id>` without actions (mentions and keywords are override/content
 *             rules, which come first, so they still notify)
 *   mute      override rule `<room id>` matching the room, without actions
 *
 * A server (space) has no rules of its own in Matrix; its setting is applied to every channel.
 */

import {
  ClientEvent,
  ConditionKind,
  PushRuleKind,
  type IPushRule,
  type IPushRules,
  type MatrixClient,
  type MatrixEvent,
  type PushRuleAction,
} from 'matrix-js-sdk'

export type RoomNotificationMode = 'default' | 'all' | 'mentions' | 'mute'

export const ROOM_NOTIFICATION_MODES: readonly RoomNotificationMode[] = ['default', 'all', 'mentions', 'mute']

function notifies(actions: PushRuleAction[]): boolean {
  return actions.includes('notify' as PushRuleAction)
}

function isMuteRule(rule: IPushRule, roomId: string): boolean {
  if (!rule.enabled || rule.rule_id !== roomId || notifies(rule.actions)) return false
  const conditions = rule.conditions ?? []
  return (
    conditions.length === 1 &&
    conditions[0].kind === ConditionKind.EventMatch &&
    'key' in conditions[0] &&
    conditions[0].key === 'room_id' &&
    'pattern' in conditions[0] &&
    conditions[0].pattern === roomId
  )
}

export function readRoomNotificationMode(rules: IPushRules | undefined, roomId: string): RoomNotificationMode {
  const global = rules?.global
  if (!global) return 'default'
  if (global.override?.some((rule) => isMuteRule(rule, roomId))) return 'mute'
  const roomRule = global.room?.find((rule) => rule.rule_id === roomId && rule.enabled)
  if (!roomRule) return 'default'
  return notifies(roomRule.actions) ? 'all' : 'mentions'
}

export function getRoomNotificationMode(client: MatrixClient, roomId: string): RoomNotificationMode {
  return readRoomNotificationMode(client.pushRules, roomId)
}

/** The common mode of several rooms (a server's channels), or null when they differ. */
export function getCommonNotificationMode(client: MatrixClient, roomIds: string[]): RoomNotificationMode | null {
  const modes = new Set(roomIds.map((roomId) => getRoomNotificationMode(client, roomId)))
  return modes.size === 1 ? [...modes][0] : null
}

function hasRule(client: MatrixClient, kind: PushRuleKind, roomId: string): boolean {
  const list = client.pushRules?.global?.[kind] as IPushRule[] | undefined
  return Boolean(list?.some((rule) => rule.rule_id === roomId))
}

async function removeRule(client: MatrixClient, kind: PushRuleKind, roomId: string): Promise<void> {
  if (hasRule(client, kind, roomId)) await client.deletePushRule('global', kind, roomId)
}

/** Writes as few rules as possible: only what differs from the current state changes. */
export async function setRoomNotificationMode(client: MatrixClient, roomId: string, mode: RoomNotificationMode): Promise<void> {
  if (getRoomNotificationMode(client, roomId) === mode) return

  if (mode !== 'mute') await removeRule(client, PushRuleKind.Override, roomId)
  if (mode === 'default' || mode === 'mute') await removeRule(client, PushRuleKind.RoomSpecific, roomId)

  if (mode === 'mute') {
    await client.addPushRule('global', PushRuleKind.Override, roomId, {
      conditions: [{ kind: ConditionKind.EventMatch, key: 'room_id', pattern: roomId }],
      actions: [],
    })
  } else if (mode === 'all' || mode === 'mentions') {
    // PUT replaces an existing room rule, no need to delete it first.
    await client.addPushRule('global', PushRuleKind.RoomSpecific, roomId, {
      actions: mode === 'all' ? ['notify' as PushRuleAction] : [],
    })
  }
}

/** One after the other: homeservers rate-limit push rule changes. */
export async function setNotificationModeForRooms(
  client: MatrixClient,
  roomIds: string[],
  mode: RoomNotificationMode,
): Promise<void> {
  for (const roomId of roomIds) await setRoomNotificationMode(client, roomId, mode)
}

/** Calls `listener` when the push rules change (here or on another device). */
export function subscribePushRules(client: MatrixClient, listener: () => void): () => void {
  const onAccountData = (event: MatrixEvent) => {
    if (event.getType() === 'm.push_rules') listener()
  }
  client.on(ClientEvent.AccountData, onAccountData)
  return () => {
    client.removeListener(ClientEvent.AccountData, onAccountData)
  }
}
