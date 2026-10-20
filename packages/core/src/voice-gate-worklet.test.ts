import { describe, expect, it } from 'vitest'
import { VoiceGate } from './voice-gate-worklet'

const RATE = 48_000
const QUANTUM = 128

/** One render quantum of a constant-amplitude signal; its RMS level is the amplitude. */
function quantum(amplitude: number): Float32Array[] {
  return [new Float32Array(QUANTUM).fill(amplitude)]
}

function run(gate: VoiceGate, amplitude: number, quanta = 1): Float32Array {
  let output = [new Float32Array(QUANTUM)]
  for (let i = 0; i < quanta; i++) {
    output = [new Float32Array(QUANTUM)]
    gate.process(quantum(amplitude), output)
  }
  return output[0]
}

const db = (value: number) => 10 ** (value / 20)
const quantaFor = (ms: number) => Math.ceil((RATE * ms) / 1000 / QUANTUM)

describe('VoiceGate', () => {
  it('stays closed below the threshold', () => {
    const gate = new VoiceGate(RATE, -40)
    expect(run(gate, db(-50), 10).every((sample) => sample === 0)).toBe(true)
    expect(gate.isOpen).toBe(false)
  })

  it('opens above the threshold and ramps up instead of jumping', () => {
    const gate = new VoiceGate(RATE, -40)
    const output = [new Float32Array(QUANTUM)]
    expect(gate.process(quantum(db(-30)), output)).toBe(true)
    expect(gate.isOpen).toBe(true)
    expect(output[0][0]).toBeGreaterThan(0)
    expect(output[0][0]).toBeLessThan(db(-30))

    expect(run(gate, db(-30), quantaFor(10))[QUANTUM - 1]).toBeCloseTo(db(-30))
  })

  it('holds the gate open through short pauses and closes after the hold time', () => {
    const gate = new VoiceGate(RATE, -40)
    run(gate, db(-30), quantaFor(20))
    run(gate, 0, quantaFor(200))
    expect(gate.isOpen).toBe(true)
    run(gate, 0, quantaFor(150))
    expect(gate.isOpen).toBe(false)
    expect(run(gate, 0, quantaFor(100)).every((sample) => sample === 0)).toBe(true)
  })

  it('keeps open while the level stays within the hysteresis below the threshold', () => {
    const gate = new VoiceGate(RATE, -40)
    run(gate, db(-30), 1)
    run(gate, db(-44), quantaFor(1000))
    expect(gate.isOpen).toBe(true)
  })

  it('applies a new threshold', () => {
    const gate = new VoiceGate(RATE, -40)
    gate.setThreshold(-60)
    run(gate, db(-50), 1)
    expect(gate.isOpen).toBe(true)
  })

  it('fills every output channel from a mono input', () => {
    const gate = new VoiceGate(RATE, -40)
    run(gate, db(-20), quantaFor(20))
    const output = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)]
    gate.process(quantum(db(-20)), output)
    expect(output[1][0]).toBeCloseTo(db(-20))
  })
})
