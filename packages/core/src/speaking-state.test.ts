import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeakingState } from './speaking-state'

afterEach(() => vi.useRealTimers())

describe('speaking indicator', () => {
  it('bridges short pauses without extending silence on repeated updates', () => {
    vi.useFakeTimers()
    const changed = vi.fn()
    const state = new SpeakingState(changed)
    state.update('alice', true)
    state.update('alice', false)
    vi.advanceTimersByTime(200)
    expect(state.has('alice')).toBe(true)
    state.update('alice', true)
    vi.advanceTimersByTime(200)
    expect(state.has('alice')).toBe(true)
    state.update('alice', false)
    vi.advanceTimersByTime(200)
    state.update('alice', false)
    vi.advanceTimersByTime(100)
    expect(state.has('alice')).toBe(false)
    expect(changed).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears mutes, departed participants and all timers on leaving', () => {
    vi.useFakeTimers()
    const state = new SpeakingState(vi.fn())
    for (const identity of ['alice', 'bob', 'carol']) {
      state.update(identity, true)
      state.update(identity, false)
    }
    state.remove('alice')
    expect(state.has('alice')).toBe(false)
    state.retain(new Set(['carol']))
    expect(state.has('bob')).toBe(false)
    expect(vi.getTimerCount()).toBe(1)
    state.clear()
    expect(state.has('carol')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
