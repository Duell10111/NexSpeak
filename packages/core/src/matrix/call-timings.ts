/** On-demand join diagnostics: no polling, tokens, room ids or service URLs. */
export class CallTimings {
  private readonly enabled: boolean
  private readonly startedAt: number

  constructor() {
    try {
      this.enabled = localStorage.getItem('nexspeak:callTimings') === '1'
    } catch {
      this.enabled = false
    }
    this.startedAt = this.enabled ? performance.now() : 0
  }

  async measure<T>(phase: string, operation: () => Promise<T>): Promise<T> {
    if (!this.enabled) return operation()
    const startedAt = performance.now()
    let status = 'failed'
    try {
      const result = await operation()
      status = 'ready'
      return result
    } finally {
      const now = performance.now()
      console.info('[call timing]', {
        phase,
        status,
        durationMs: Math.round(now - startedAt),
        elapsedMs: Math.round(now - this.startedAt),
      })
    }
  }
}
