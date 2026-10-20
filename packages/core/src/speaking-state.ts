/** Keeps short pauses from flashing the speaking indicator off. No work runs while idle. */
export class SpeakingState {
  private readonly active = new Set<string>()
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly changed: () => void) {}

  has(identity: string): boolean {
    return this.active.has(identity)
  }

  update(identity: string, speaking: boolean): void {
    if (speaking) {
      clearTimeout(this.pending.get(identity))
      this.pending.delete(identity)
      if (this.active.has(identity)) return
      this.active.add(identity)
      this.changed()
    } else if (this.active.has(identity) && !this.pending.has(identity)) {
      this.pending.set(identity, setTimeout(() => this.remove(identity), 300))
    }
  }

  /** Mutes and departures bypass the hold time. */
  remove(identity: string): void {
    clearTimeout(this.pending.get(identity))
    this.pending.delete(identity)
    if (this.active.delete(identity)) this.changed()
  }

  retain(identities: ReadonlySet<string>): void {
    for (const identity of this.active) {
      if (!identities.has(identity)) this.remove(identity)
    }
  }

  clear(): void {
    this.pending.forEach(clearTimeout)
    this.pending.clear()
    this.active.clear()
  }
}
