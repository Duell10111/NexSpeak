/**
 * Microphone processing beyond the browser's built-in one: RNNoise noise suppression and the voice
 * activity gate, both as AudioWorklets (audio thread, never the main thread). The browser's own
 * echo cancellation, noise suppression and gain control are getUserMedia constraints.
 *
 * Nothing here runs unless a call (or the microphone test) needs it: the default settings only
 * use the browser's processing and create no AudioContext at all.
 */

import type { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'
import { VOICE_GATE_PROCESSOR, type VoiceGateConfig, type VoiceGateState } from './voice-gate-worklet'

/** browser: the browser's built-in suppression; enhanced: RNNoise; off: none at all. */
export type NoiseSuppressionMode = 'browser' | 'enhanced' | 'off'
export const NOISE_SUPPRESSION_MODES: readonly NoiseSuppressionMode[] = ['browser', 'enhanced', 'off']

export interface AudioProcessingOptions {
  noiseSuppression: NoiseSuppressionMode
  echoCancellation: boolean
  autoGainControl: boolean
  /** Input sensitivity of the voice activity gate in dBFS; null transmits everything. */
  voiceGateDb: number | null
}

export const DEFAULT_AUDIO_PROCESSING: AudioProcessingOptions = {
  noiseSuppression: 'browser',
  echoCancellation: true,
  autoGainControl: true,
  voiceGateDb: null,
}

/** Copied there by apps/web/scripts/copy-public-assets.mjs. */
const ASSETS = '/audio-processing'
const RNNOISE_WORKLET_URL = `${ASSETS}/rnnoise-worklet.js`
const VOICE_GATE_WORKLET_URL = `${ASSETS}/voice-gate-worklet.js`
/** RNNoise only works at 48 kHz. */
const RNNOISE_SAMPLE_RATE = 48_000

/** getUserMedia constraints; the browser's suppression is off whenever RNNoise replaces it. */
export function captureConstraints(
  options: AudioProcessingOptions,
): { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean } {
  return {
    echoCancellation: options.echoCancellation,
    noiseSuppression: options.noiseSuppression === 'browser',
    autoGainControl: options.autoGainControl,
  }
}

/** Whether the microphone has to go through Web Audio at all. */
export function needsAudioGraph(options: AudioProcessingOptions): boolean {
  return options.noiseSuppression === 'enhanced' || options.voiceGateDb !== null
}

export function sameCaptureConstraints(a: AudioProcessingOptions, b: AudioProcessingOptions): boolean {
  const left = captureConstraints(a)
  const right = captureConstraints(b)
  return (
    left.echoCancellation === right.echoCancellation &&
    left.noiseSuppression === right.noiseSuppression &&
    left.autoGainControl === right.autoGainControl
  )
}

// Loaded on first use: the library subclasses AudioWorkletNode when imported, which doesn't exist
// during the static prerender, and nobody without enhanced suppression needs it.
const loadNoiseSuppressor = () => import('@sapphi-red/web-noise-suppressor')

let rnnoiseBinary: Promise<ArrayBuffer> | null = null

function loadRnnoiseBinary(): Promise<ArrayBuffer> {
  rnnoiseBinary ??= loadNoiseSuppressor()
    .then(({ loadRnnoise }) => loadRnnoise({ url: `${ASSETS}/rnnoise.wasm`, simdUrl: `${ASSETS}/rnnoise_simd.wasm` }))
    .catch((error: unknown) => {
      rnnoiseBinary = null
      throw error
    })
  return rnnoiseBinary
}

/**
 * An AudioContext the microphone can be connected to, preferably at 48 kHz for RNNoise. Chrome
 * resamples a microphone with another rate; Firefox refuses to, so it falls back to the default
 * rate there (without RNNoise, see AudioProcessingChain).
 */
export function openProcessingSource(track: MediaStreamTrack): {
  context: AudioContext
  source: MediaStreamAudioSourceNode
} {
  const context = new AudioContext({ sampleRate: RNNOISE_SAMPLE_RATE, latencyHint: 'interactive' })
  try {
    return { context, source: context.createMediaStreamSource(new MediaStream([track])) }
  } catch {
    void context.close()
    const fallback = new AudioContext({ latencyHint: 'interactive' })
    try {
      return { context: fallback, source: fallback.createMediaStreamSource(new MediaStream([track])) }
    } catch (error) {
      void fallback.close()
      throw error
    }
  }
}

/**
 * input → [RNNoise] → [voice gate] → output inside one AudioContext. The voice gate can be
 * switched and tuned while it runs, without replacing input or output.
 *
 * RNNoise is fixed per chain: its worklet ignores the destroy message (the processor never starts
 * its message port), so only closing the AudioContext stops it.
 */
export class AudioProcessingChain {
  readonly input: GainNode
  private gate: AudioWorkletNode | null = null
  private gateModule: Promise<void> | null = null
  private queue: Promise<void> = Promise.resolve()
  private destroyed = false

  /** Called when the voice gate opens or closes. */
  onGateChange?: (open: boolean) => void

  private constructor(
    private readonly context: AudioContext,
    private readonly output: AudioNode,
    private readonly rnnoise: RnnoiseWorkletNode | null,
  ) {
    this.input = context.createGain()
    if (rnnoise) this.input.connect(rnnoise)
    this.tail.connect(output)
  }

  static async create(
    context: AudioContext,
    output: AudioNode,
    options: AudioProcessingOptions,
  ): Promise<AudioProcessingChain> {
    let rnnoise: RnnoiseWorkletNode | null = null
    if (options.noiseSuppression === 'enhanced') {
      if (context.sampleRate === RNNOISE_SAMPLE_RATE) {
        const [{ RnnoiseWorkletNode }, wasmBinary] = await Promise.all([
          loadNoiseSuppressor(),
          loadRnnoiseBinary(),
          context.audioWorklet.addModule(RNNOISE_WORKLET_URL),
        ])
        rnnoise = new RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary })
      } else {
        console.warn(`RNNoise needs ${RNNOISE_SAMPLE_RATE} Hz, the microphone runs at ${context.sampleRate} Hz`)
      }
    }
    const chain = new AudioProcessingChain(context, output, rnnoise)
    await chain.setVoiceGate(options.voiceGateDb)
    return chain
  }

  /** Whether options need a new chain instead of setVoiceGate(). */
  needsRebuild(options: AudioProcessingOptions): boolean {
    return (options.noiseSuppression === 'enhanced') !== (this.rnnoise !== null)
  }

  /** Where the voice gate takes the signal: after RNNoise, if any. The microphone test meters this. */
  get beforeGate(): AudioNode {
    return this.rnnoise ?? this.input
  }

  private get tail(): AudioNode {
    return this.beforeGate
  }

  /** Input sensitivity in dBFS, or null to transmit everything. Calls apply in order. */
  setVoiceGate(thresholdDb: number | null): Promise<void> {
    this.queue = this.queue
      .then(() => this.applyVoiceGate(thresholdDb))
      .catch((error: unknown) => console.warn('Failed to set up the voice activity gate:', error))
    return this.queue
  }

  private async applyVoiceGate(thresholdDb: number | null): Promise<void> {
    if (thresholdDb !== null && this.gate) {
      this.gate.port.postMessage({ thresholdDb } satisfies VoiceGateConfig)
    } else if (thresholdDb !== null) {
      this.gateModule ??= this.context.audioWorklet.addModule(VOICE_GATE_WORKLET_URL)
      await this.gateModule
      if (this.destroyed) return
      this.gate = new AudioWorkletNode(this.context, VOICE_GATE_PROCESSOR, {
        processorOptions: { thresholdDb } satisfies VoiceGateConfig,
      })
      this.gate.port.onmessage = (event: MessageEvent<VoiceGateState>) => this.onGateChange?.(event.data.open)
      this.tail.disconnect()
      this.tail.connect(this.gate)
      this.gate.connect(this.output)
    } else if (this.gate) {
      this.tail.disconnect()
      this.gate.port.onmessage = null
      this.gate.disconnect()
      this.gate = null
      this.tail.connect(this.output)
      this.onGateChange?.(true)
    }
  }

  destroy(): void {
    this.destroyed = true
    this.rnnoise?.destroy()
    this.rnnoise?.disconnect()
    this.gate?.disconnect()
    this.input.disconnect()
  }
}

/**
 * LiveKit track processor that sends the microphone through AudioProcessingChain. Uses its own
 * AudioContext (RNNoise needs 48 kHz), not the one LiveKit passes in.
 */
export class CallAudioProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'nexspeak-audio-processing'
  processedTrack?: MediaStreamTrack
  /** The unprocessed microphone track (push to talk gates this one). */
  inputTrack?: MediaStreamTrack

  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private chain?: AudioProcessingChain
  private destination?: MediaStreamAudioDestinationNode

  constructor(private options: AudioProcessingOptions) {}

  async init({ track }: AudioProcessorOptions): Promise<void> {
    const { context, source } = openProcessingSource(track)
    this.context = context
    this.source = source
    this.inputTrack = track
    this.destination = context.createMediaStreamDestination()
    this.chain = await AudioProcessingChain.create(context, this.destination, this.options)
    source.connect(this.chain.input)
    this.processedTrack = this.destination.stream.getAudioTracks()[0]
  }

  /** LiveKit replaced the microphone track (device switch, restart). */
  async restart({ track }: AudioProcessorOptions): Promise<void> {
    if (!this.context || !this.chain) return
    this.source?.disconnect()
    this.source = this.context.createMediaStreamSource(new MediaStream([track]))
    this.source.connect(this.chain.input)
    this.inputTrack = track
  }

  /** Applies new options in place; false when they need a new processor (RNNoise on or off). */
  async update(options: AudioProcessingOptions): Promise<boolean> {
    if (!this.chain || this.chain.needsRebuild(options)) return false
    this.options = options
    await this.chain.setVoiceGate(options.voiceGateDb)
    return true
  }

  /** Stops the audio thread's work while the microphone is muted. */
  setActive(active: boolean): void {
    if (!this.context || this.context.state === 'closed') return
    void (active ? this.context.resume() : this.context.suspend()).catch(() => {})
  }

  async destroy(): Promise<void> {
    this.source?.disconnect()
    this.chain?.destroy()
    await this.context?.close().catch(() => {})
    this.context = undefined
    this.chain = undefined
  }
}
