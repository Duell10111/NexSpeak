import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMediaPlayback } from './media-playback'

class Player extends EventTarget {
  src: string | null = null
  pause = vi.fn()
  load = vi.fn()
  play = vi.fn(async () => {})
  hasAttribute() { return this.src !== null }
  removeAttribute() { this.src = null }
}

function setup(load = vi.fn(async (signal: AbortSignal) => { signal.throwIfAborted(); return new Blob(['media']) })) {
  const element = new Player()
  const state = vi.fn()
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:playback')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const controller = createMediaPlayback(element as unknown as HTMLMediaElement, load, state)
  return { element, state, create, revoke, controller, load }
}

afterEach(() => vi.restoreAllMocks())

describe('attachment playback lifecycle', () => {
  it('loads only after Play and releases decoder buffers and the blob on leaving view', async () => {
    const { controller, load, element, create, revoke, state } = setup()
    expect(load).not.toHaveBeenCalled()
    await controller.start()
    expect(element.src).toBe('blob:playback')
    expect(element.play).toHaveBeenCalledOnce()
    await controller.start()
    expect(load).toHaveBeenCalledOnce()
    controller.release()
    expect(element.pause).toHaveBeenCalledOnce()
    expect(element.src).toBeNull()
    expect(element.load).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:playback')
    expect(state).toHaveBeenLastCalledWith('idle')
    await controller.start()
    expect(create).toHaveBeenCalledTimes(2)
    controller.dispose()
    expect(revoke).toHaveBeenCalledTimes(2)
  })

  it('aborts pending downloads and ignores decryption finishing after channel changes', async () => {
    let finish!: (blob: Blob) => void
    const load = vi.fn((signal: AbortSignal) => { signal.throwIfAborted(); return new Promise<Blob>((resolve) => { finish = resolve }) })
    const { controller, create, element } = setup(load)
    const pending = controller.start()
    const signal = load.mock.calls[0][0]
    controller.dispose()
    expect(signal.aborted).toBe(true)
    finish(new Blob(['late plaintext']))
    await pending
    expect(create).not.toHaveBeenCalled()
    expect(element.play).not.toHaveBeenCalled()
  })

  it('cancels loading outside the viewport and permits another explicit Play', async () => {
    let finish!: (blob: Blob) => void
    const load = vi.fn((signal: AbortSignal) => { signal.throwIfAborted(); return new Promise<Blob>((resolve) => { finish = resolve }) })
    const { controller, create } = setup(load)
    const pending = controller.start()
    controller.release()
    expect(load.mock.calls[0][0].aborted).toBe(true)
    finish(new Blob(['cancelled']))
    await pending
    expect(create).not.toHaveBeenCalled()
    const next = controller.start()
    finish(new Blob(['current']))
    await next
    expect(create).toHaveBeenCalledOnce()
    controller.dispose()
  })

  it('releases unplayable media and allows retry after download failure', async () => {
    const { controller, element, revoke, state, load } = setup()
    load.mockRejectedValueOnce(new Error('offline'))
    await controller.start()
    expect(state).toHaveBeenLastCalledWith('failed')
    await controller.start()
    element.dispatchEvent(new Event('error'))
    expect(element.src).toBeNull()
    expect(revoke).toHaveBeenCalledOnce()
    expect(state).toHaveBeenLastCalledWith('failed')
    controller.dispose()
  })

  it('keeps native controls usable when async loading loses user activation', async () => {
    const { controller, element, state } = setup()
    element.play.mockRejectedValueOnce(Object.assign(new Error('gesture required'), { name: 'NotAllowedError' }))
    await controller.start()
    expect(element.src).toBe('blob:playback')
    expect(state).toHaveBeenLastCalledWith('ready')
    controller.dispose()
  })
})
