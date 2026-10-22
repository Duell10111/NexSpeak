'use client'

import { useSyncExternalStore } from 'react'

// One set of focus listeners for every animated image or GIF on screen, with no polling or frame loops.
const listeners = new Set<() => void>()
function notify() { listeners.forEach((listener) => listener()) }
function subscribe(listener: () => void) {
  if (!listeners.size) {
    window.addEventListener('focus', notify)
    window.addEventListener('blur', notify)
    document.addEventListener('visibilitychange', notify)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      window.removeEventListener('focus', notify)
      window.removeEventListener('blur', notify)
      document.removeEventListener('visibilitychange', notify)
    }
  }
}
const focused = () => document.visibilityState === 'visible' && document.hasFocus()
const unfocused = () => false

/** Animations run only while this is true: the window is visible and has the focus. */
export function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribe, focused, unfocused)
}
