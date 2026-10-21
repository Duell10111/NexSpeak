export type PlaybackState = 'idle' | 'loading' | 'ready' | 'failed'

/** One uncached attachment per player. Releasing also cancels an in-flight download. */
export function createMediaPlayback(
  element: HTMLMediaElement,
  load: (signal: AbortSignal) => Promise<Blob>,
  onState: (state: PlaybackState) => void,
) {
  let request: AbortController | null = null
  let url: string | null = null
  let disposed = false

  function release(state: PlaybackState = 'idle') {
    request?.abort()
    request = null
    // Detach before revoking so the decoder releases its buffers too.
    if (element.hasAttribute('src')) {
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
    if (url) URL.revokeObjectURL(url)
    url = null
    if (!disposed) onState(state)
  }

  const failed = () => release('failed')
  element.addEventListener('error', failed)

  return {
    async start() {
      if (disposed || request || url) return
      const current = new AbortController()
      request = current
      onState('loading')
      try {
        const blob = await load(current.signal)
        // Loaders (including WebCrypto) may finish after cancellation.
        if (current.signal.aborted || disposed) return
        url = URL.createObjectURL(blob)
        element.src = url
        onState('ready')
        try {
          await element.play()
        } catch (error) {
          // Async decryption may outlive the browser's user activation; native Play still works.
          if (error instanceof Error && error.name === 'NotAllowedError') return
          if (!current.signal.aborted) release('failed')
        }
      } catch {
        if (!current.signal.aborted) release('failed')
      } finally {
        if (request === current) request = null
      }
    },
    release,
    dispose() {
      disposed = true
      element.removeEventListener('error', failed)
      release()
    },
  }
}
