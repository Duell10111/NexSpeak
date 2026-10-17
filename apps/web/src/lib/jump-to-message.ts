/** Scrolls to a message if it is loaded in the open chat and flashes it; true when it was found. */
export function jumpToMessage(eventId: string): boolean {
  const element = document.getElementById(`msg-${eventId}`)
  if (!element) return false
  element.scrollIntoView({ behavior: "smooth", block: "center" })
  element.classList.add("bg-primary/10")
  setTimeout(() => element.classList.remove("bg-primary/10"), 1500)
  return true
}
