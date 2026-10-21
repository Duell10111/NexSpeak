/** Opt-in switch set with localStorage.setItem(key, '1'); off when storage is unavailable. */
export function localFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
