import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioProcessingChain, captureConstraints, DEFAULT_AUDIO_PROCESSING, needsAudioGraph, sameCaptureConstraints, updateAudioCapture } from './audio-processing'

afterEach(() => vi.unstubAllGlobals())

describe('audio processing options', () => {
  it('uses only the browser processing by default', () => {
    expect(needsAudioGraph(DEFAULT_AUDIO_PROCESSING)).toBe(false)
    expect(captureConstraints(DEFAULT_AUDIO_PROCESSING)).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    })
  })

  it('turns the browser suppression off when RNNoise replaces it', () => {
    const enhanced = { ...DEFAULT_AUDIO_PROCESSING, noiseSuppression: 'enhanced' as const }
    expect(captureConstraints(enhanced).noiseSuppression).toBe(false)
    expect(needsAudioGraph(enhanced)).toBe(true)
    expect(captureConstraints({ ...DEFAULT_AUDIO_PROCESSING, noiseSuppression: 'off' }).noiseSuppression).toBe(false)
  })

  it('needs the audio graph for the voice gate', () => {
    expect(needsAudioGraph({ ...DEFAULT_AUDIO_PROCESSING, voiceGateDb: -50 })).toBe(true)
  })

  it('tells whether the microphone has to be reopened', () => {
    expect(sameCaptureConstraints(DEFAULT_AUDIO_PROCESSING, { ...DEFAULT_AUDIO_PROCESSING, voiceGateDb: -50 })).toBe(true)
    expect(sameCaptureConstraints(DEFAULT_AUDIO_PROCESSING, { ...DEFAULT_AUDIO_PROCESSING, echoCancellation: false })).toBe(
      false,
    )
    expect(
      sameCaptureConstraints(
        { ...DEFAULT_AUDIO_PROCESSING, noiseSuppression: 'off' },
        { ...DEFAULT_AUDIO_PROCESSING, noiseSuppression: 'enhanced' },
      ),
    ).toBe(true)
  })
})

describe('live microphone capture settings', () => {
  const options = { ...DEFAULT_AUDIO_PROCESSING, noiseSuppression: 'off' as const, echoCancellation: false, autoGainControl: false }

  it('disables all browser processing on the existing source track without another capture', async () => {
    const track = { applyConstraints: vi.fn().mockResolvedValue(undefined), restartTrack: vi.fn() }
    await updateAudioCapture(track, { getSettings: () => captureConstraints(options) }, options, 'microphone')
    expect(track.applyConstraints).toHaveBeenCalledExactlyOnceWith({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
    expect(track.restartTrack).not.toHaveBeenCalled()
  })

  it.each(['rejected', 'ignored'] as const)('reopens only when the browser %s live changes', async (outcome) => {
    const track = {
      applyConstraints: outcome === 'rejected' ? vi.fn().mockRejectedValue(new Error('Not supported')) : vi.fn().mockResolvedValue(undefined),
      restartTrack: vi.fn().mockResolvedValue(undefined),
    }
    await updateAudioCapture(track, { getSettings: () => captureConstraints(DEFAULT_AUDIO_PROCESSING) }, options, 'microphone')
    expect(track.restartTrack).toHaveBeenCalledExactlyOnceWith({
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: { ideal: 'microphone' },
    })
  })

  it('accepts live changes when a browser does not report audio settings', async () => {
    const track = { applyConstraints: vi.fn().mockResolvedValue(undefined), restartTrack: vi.fn() }
    await updateAudioCapture(track, { getSettings: () => ({}) }, options, 'default')
    expect(track.restartTrack).not.toHaveBeenCalled()
  })

  it('propagates a failed fallback instead of reporting successful microphone processing', async () => {
    const error = new Error('Device unavailable')
    const track = { applyConstraints: vi.fn().mockRejectedValue(new Error('Not supported')), restartTrack: vi.fn().mockRejectedValue(error) }
    await expect(updateAudioCapture(track, { getSettings: () => ({}) }, options, 'missing')).rejects.toBe(error)
  })

  it('does not reopen a microphone after leaving while a live change is pending', async () => {
    const pending = Promise.withResolvers<void>()
    let active = true
    const track = { applyConstraints: vi.fn(() => pending.promise), restartTrack: vi.fn() }
    const update = updateAudioCapture(track, { getSettings: () => ({}) }, options, 'default', () => active)
    active = false
    pending.reject(new Error('Track stopped'))
    await update
    expect(track.restartTrack).not.toHaveBeenCalled()
  })
})

describe('audio processing graph', () => {
  function setup(addModule = vi.fn().mockResolvedValue(undefined)) {
    class Node {
      readonly connections = new Set<Node>()
      connect(destination: Node) { this.connections.add(destination) }
      disconnect(destination?: Node) {
        if (destination) {
          if (!this.connections.delete(destination)) throw new Error('Not connected')
        } else {
          this.connections.clear()
        }
      }
    }
    class Worklet extends Node {
      readonly port = { onmessage: null, postMessage: vi.fn(), close: vi.fn() }
      constructor() { super(); worklets.push(this) }
    }
    const worklets: Worklet[] = []
    vi.stubGlobal('AudioWorkletNode', Worklet)
    const input = new Node()
    const output = new Node()
    const analyser = new Node()
    const context = {
      createGain: () => input,
      audioWorklet: { addModule },
    } as unknown as AudioContext
    return { context, input, output, analyser, worklets }
  }

  it('preserves the meter branch across repeated gate toggles and retires every worklet', async () => {
    const { context, input, output, analyser, worklets } = setup()
    const chain = await AudioProcessingChain.create(context, output as unknown as AudioNode, DEFAULT_AUDIO_PROCESSING)
    chain.beforeGate.connect(analyser as unknown as AudioNode)
    for (let i = 0; i < 3; i++) {
      await chain.setVoiceGate(-50)
      const gate = worklets[i]
      expect(input.connections).toEqual(new Set([analyser, gate]))
      expect(gate.connections).toEqual(new Set([output]))
      await chain.setVoiceGate(-40)
      expect(worklets).toHaveLength(i + 1)
      expect(gate.port.postMessage).toHaveBeenCalledWith({ thresholdDb: -40 })
      await chain.setVoiceGate(null)
      expect(input.connections).toEqual(new Set([analyser, output]))
      expect(gate.connections.size).toBe(0)
      expect(gate.port.postMessage).toHaveBeenLastCalledWith({ destroy: true })
      expect(gate.port.close).toHaveBeenCalledOnce()
      expect(gate.port.onmessage).toBeNull()
    }
    chain.destroy()
  })

  it('retires an active gate on destruction and ignores queued changes afterward', async () => {
    const { context, output, input, worklets } = setup()
    const chain = await AudioProcessingChain.create(context, output as unknown as AudioNode, {
      ...DEFAULT_AUDIO_PROCESSING, voiceGateDb: -50,
    })
    const queued = chain.setVoiceGate(-40)
    chain.destroy()
    chain.destroy()
    await queued
    await chain.setVoiceGate(-30)
    expect(worklets).toHaveLength(1)
    expect(worklets[0].port.postMessage).toHaveBeenCalledExactlyOnceWith({ destroy: true })
    expect(worklets[0].port.close).toHaveBeenCalledOnce()
    expect(input.connections.size).toBe(0)
  })

  it('does not create a gate after destruction while its module is loading', async () => {
    let loaded!: () => void
    const moduleLoaded = new Promise<void>((resolve) => { loaded = resolve })
    const addModule = vi.fn(() => moduleLoaded)
    const { context, output, worklets } = setup(addModule)
    const chain = await AudioProcessingChain.create(context, output as unknown as AudioNode, DEFAULT_AUDIO_PROCESSING)
    const queued = chain.setVoiceGate(-50)
    await vi.waitFor(() => expect(addModule).toHaveBeenCalledOnce())
    chain.destroy()
    loaded()
    await queued
    expect(worklets).toHaveLength(0)
  })
})
