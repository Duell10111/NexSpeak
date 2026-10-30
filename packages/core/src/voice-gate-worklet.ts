/**
 * Voice activity gate: lets the microphone through only while its level is above the user's input
 * sensitivity, like Discord's voice activity mode. Runs as an AudioWorklet (the audio thread, never
 * the main thread).
 *
 * The web build ships this file type-stripped as public/audio-processing/voice-gate-worklet.js
 * (apps/web/scripts/copy-public-assets.mjs), so it must stay self-contained: no imports and only
 * erasable TypeScript syntax (no enums, namespaces or parameter properties).
 */

// AudioWorkletGlobalScope; not part of TypeScript's DOM library.
declare const sampleRate: number
declare function registerProcessor(name: string, processor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

export const VOICE_GATE_PROCESSOR = 'nexspeak-voice-gate'

/** Stays open this long after the level drops, so word endings and short pauses aren't cut off. */
const HOLD_MS = 300
/** Once open, the level may drop this far below the threshold before the hold time starts. */
const CLOSE_HYSTERESIS_DB = 6
/** Gain ramps instead of hard cuts, which would click. */
const ATTACK_MS = 5
const RELEASE_MS = 50

/** Main thread → worklet. */
export interface VoiceGateConfig {
  thresholdDb: number
}

export type VoiceGateMessage = VoiceGateConfig | { destroy: true }

/** Worklet → main thread, only when the gate opens or closes. */
export interface VoiceGateState {
  open: boolean
}

const dbToLinear = (db: number) => 10 ** (db / 20)

export class VoiceGate {
  private openLevel = 0
  private closeLevel = 0
  private readonly holdSamples: number
  private readonly attackStep: number
  private readonly releaseStep: number
  private heldSamples = 0
  private gain = 0
  isOpen = false

  constructor(rate: number, thresholdDb: number) {
    this.holdSamples = Math.round((rate * HOLD_MS) / 1000)
    this.attackStep = 1000 / (rate * ATTACK_MS)
    this.releaseStep = 1000 / (rate * RELEASE_MS)
    this.setThreshold(thresholdDb)
  }

  setThreshold(thresholdDb: number): void {
    this.openLevel = dbToLinear(thresholdDb)
    this.closeLevel = dbToLinear(thresholdDb - CLOSE_HYSTERESIS_DB)
  }

  /** Copies one render quantum from input to output through the gate; true when the gate opened or closed. */
  process(input: readonly Float32Array[], output: Float32Array[]): boolean {
    const length = output[0]?.length ?? 0
    if (input.length === 0 || length === 0) return false

    let level = 0
    for (const channel of input) {
      let sum = 0
      for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i]
      level = Math.max(level, Math.sqrt(sum / channel.length))
    }

    const wasOpen = this.isOpen
    if (level >= this.openLevel) {
      this.isOpen = true
      this.heldSamples = 0
    } else if (this.isOpen && level < this.closeLevel) {
      this.heldSamples += length
      if (this.heldSamples >= this.holdSamples) this.isOpen = false
    } else {
      this.heldSamples = 0
    }

    const target = this.isOpen ? 1 : 0
    const start = this.gain
    let end = start
    for (let c = 0; c < output.length; c++) {
      const source = input[Math.min(c, input.length - 1)]
      const sink = output[c]
      if (start === target) {
        // Steady state: no per-sample work.
        if (target === 1) sink.set(source)
        else sink.fill(0)
        continue
      }
      let gain = start
      for (let i = 0; i < length; i++) {
        gain = target > gain ? Math.min(target, gain + this.attackStep) : Math.max(target, gain - this.releaseStep)
        sink[i] = source[i] * gain
      }
      end = gain
    }
    this.gain = end
    return this.isOpen !== wasOpen
  }
}

if (typeof registerProcessor === 'function') {
  registerProcessor(
    VOICE_GATE_PROCESSOR,
    class extends AudioWorkletProcessor {
      private readonly gate: VoiceGate
      private destroyed = false

      constructor(options: { processorOptions: VoiceGateConfig }) {
        super()
        this.gate = new VoiceGate(sampleRate, options.processorOptions.thresholdDb)
        this.port.onmessage = (event: MessageEvent<VoiceGateMessage>) => {
          if ('destroy' in event.data) {
            this.destroyed = true
            this.port.onmessage = null
            this.port.close()
          } else {
            this.gate.setThreshold(event.data.thresholdDb)
          }
        }
      }

      process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (this.destroyed) return false
        if (this.gate.process(inputs[0] ?? [], outputs[0] ?? [])) {
          this.port.postMessage({ open: this.gate.isOpen } satisfies VoiceGateState)
        }
        return true
      }
    },
  )
}
