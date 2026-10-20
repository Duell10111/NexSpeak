"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AudioProcessingChain, captureConstraints, openProcessingSource } from "@nexspeak/core/audio-processing"
import { t as translate } from "@nexspeak/i18n"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useTranslation } from "@/hooks/useTranslation"
import { audioProcessingOptions, MIN_INPUT_SENSITIVITY_DB, type AudioSettings } from "@/lib/audio-settings"

/** Level and threshold use the same dBFS scale. */
function levelPercent(db: number): number {
  return Math.min(100, Math.max(0, ((db - MIN_INPUT_SENSITIVITY_DB) / -MIN_INPUT_SENSITIVITY_DB) * 100))
}

/** Only captures while explicitly testing; sensitivity changes reach the running worklet. */
export function MicrophoneTest({ settings }: { settings: AudioSettings }) {
  const { t } = useTranslation()
  const [running, setRunning] = useState(false)
  const [level, setLevel] = useState(0)
  const [gateOpen, setGateOpen] = useState(false)
  const chainRef = useRef<AudioProcessingChain | null>(null)
  const threshold = audioProcessingOptions(settings).voiceGateDb
  const thresholdRef = useRef(threshold)

  useEffect(() => {
    thresholdRef.current = threshold
    void chainRef.current?.setVoiceGate(threshold)
  }, [threshold])

  const { inputDeviceId, noiseSuppression, echoCancellation, autoGainControl } = settings
  useEffect(() => {
    if (!running) return
    let stopped = false
    let stream: MediaStream | undefined
    let context: AudioContext | undefined
    let chain: AudioProcessingChain | null = null
    let frame = 0
    const stop = () => {
      stopped = true
      cancelAnimationFrame(frame)
      chain?.destroy()
      if (chainRef.current === chain) chainRef.current = null
      chain = null
      stream?.getTracks().forEach((track) => track.stop())
      stream = undefined
      void context?.close().catch(() => {})
      context = undefined
    }

    const start = async () => {
      setLevel(0)
      setGateOpen(false)
      const processing = { noiseSuppression, echoCancellation, autoGainControl, voiceGateDb: thresholdRef.current }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
            ...captureConstraints(processing),
          },
        })
        if (stopped) { stop(); return }
        const opened = openProcessingSource(stream.getAudioTracks()[0])
        context = opened.context
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        // Always keep a chain during the test so enabling sensitivity doesn't reopen the mic.
        // A MediaStream destination pulls it without playing the microphone through speakers.
        chain = await AudioProcessingChain.create(context, context.createMediaStreamDestination(), processing)
        if (stopped) { stop(); return }
        chainRef.current = chain
        chain.onGateChange = (open) => { if (!stopped) setGateOpen(open) }
        // The threshold may have changed while permission or a worklet download was pending.
        await chain.setVoiceGate(thresholdRef.current)
        if (stopped) { stop(); return }
        opened.source.connect(chain.input)
        chain.beforeGate.connect(analyser)
        const buffer = new Float32Array(analyser.fftSize)
        let lastUpdate = -Infinity
        const tick = (now: number) => {
          // The meter is purely visual. Limit React updates and skip hidden documents.
          if (!document.hidden && now - lastUpdate >= 1000 / 15) {
            lastUpdate = now
            analyser.getFloatTimeDomainData(buffer)
            let sum = 0
            for (const sample of buffer) sum += sample * sample
            setLevel(Math.round(levelPercent(20 * Math.log10(Math.sqrt(sum / buffer.length) || 1e-10))))
          }
          frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
      } catch (error) {
        const wasStopped = stopped
        stop()
        if (wasStopped) return
        setRunning(false)
        console.error("Failed to test microphone:", error)
        toast.error(translate("settings.micOpenFailed"))
      }
    }
    void start()
    return stop
  }, [running, inputDeviceId, noiseSuppression, echoCancellation, autoGainControl])

  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" onClick={() => setRunning(!running)} className="w-full">
        {running ? t("settings.stopMicTest") : t("settings.testMic")}
      </Button>
      {running && (
        <>
          <div className="relative">
            <Progress value={level} aria-label={t("settings.micLevel")} className="[&>div]:transition-none" />
            {threshold !== null && (
              <div
                className="absolute -top-1 -bottom-1 w-0.5 rounded bg-foreground"
                style={{ left: `${levelPercent(threshold)}%` }}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {threshold === null ? t("settings.speakNow") : gateOpen ? t("settings.micTransmitting") : t("settings.micNotTransmitting")}
          </p>
        </>
      )}
    </div>
  )
}
