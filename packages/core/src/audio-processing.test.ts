import { describe, expect, it } from 'vitest'
import { captureConstraints, DEFAULT_AUDIO_PROCESSING, needsAudioGraph, sameCaptureConstraints } from './audio-processing'

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
