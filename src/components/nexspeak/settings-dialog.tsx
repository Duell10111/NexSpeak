"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Mic, Headphones } from "lucide-react"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface AudioSettings {
  inputDevice: string
  outputDevice: string
  inputVolume: number
  outputVolume: number
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [audioSettings, setAudioSettings] = useState<AudioSettings>({
    inputDevice: "default",
    outputDevice: "default",
    inputVolume: 100,
    outputVolume: 100,
  })

  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [isTesting, setIsTesting] = useState(false)

  // Lade verfügbare Audio-Geräte
  useEffect(() => {
    const loadDevices = async () => {
      try {
        // Fordere Berechtigung an
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
          stream.getTracks().forEach((track) => track.stop())
        })

        const devices = await navigator.mediaDevices.enumerateDevices()
        const inputDevs = devices.filter((device) => device.kind === "audioinput")
        const outputDevs = devices.filter((device) => device.kind === "audiooutput")

        setInputDevices(inputDevs)
        setOutputDevices(outputDevs)

        // Setze Standard-Geräte falls verfügbar
        if (inputDevs.length > 0 && audioSettings.inputDevice === "default") {
          setAudioSettings((prev) => ({
            ...prev,
            inputDevice: inputDevs[0].deviceId,
          }))
        }
        if (outputDevs.length > 0 && audioSettings.outputDevice === "default") {
          setAudioSettings((prev) => ({
            ...prev,
            outputDevice: outputDevs[0].deviceId,
          }))
        }
      } catch (error) {
        console.error("Failed to enumerate devices:", error)
      }
    }

    if (open) {
      loadDevices()
    }
  }, [open])

  const handleInputDeviceChange = (deviceId: string) => {
    setAudioSettings((prev) => ({
      ...prev,
      inputDevice: deviceId,
    }))
    // Hier könnte die Einstellung in localStorage oder einer API gespeichert werden
  }

  const handleOutputDeviceChange = (deviceId: string) => {
    setAudioSettings((prev) => ({
      ...prev,
      outputDevice: deviceId,
    }))
  }

  const handleInputVolumeChange = (value: number[]) => {
    setAudioSettings((prev) => ({
      ...prev,
      inputVolume: value[0],
    }))
  }

  const handleOutputVolumeChange = (value: number[]) => {
    setAudioSettings((prev) => ({
      ...prev,
      outputVolume: value[0],
    }))
  }

  const testMicrophone = async () => {
    setIsTesting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: audioSettings.inputDevice },
      })
      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)

      // Prüfe ob Audio ankommt
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      let maxVolume = 0

      const checkVolume = () => {
        analyser.getByteFrequencyData(dataArray)
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length
        maxVolume = Math.max(maxVolume, average)

        if (maxVolume > 10) {
          // Audio erkannt
          stream.getTracks().forEach((track) => track.stop())
          audioContext.close()
          setIsTesting(false)
          alert("Mikrofon funktioniert! Schall erkannt.")
        } else if (audioContext.currentTime < 3) {
          // 3 Sekunden testen
          requestAnimationFrame(checkVolume)
        } else {
          stream.getTracks().forEach((track) => track.stop())
          audioContext.close()
          setIsTesting(false)
          if (maxVolume === 0) {
            alert("Kein Schall erkannt. Bitte stelle sicher, dass dein Mikrofon angeschlossen ist.")
          }
        }
      }

      checkVolume()
    } catch (error) {
      console.error("Failed to test microphone:", error)
      setIsTesting(false)
      alert("Fehler beim Testen des Mikrofons. Bitte überprüfe die Berechtigungen.")
    }
  }

  const testSpeaker = async () => {
    setIsTesting(true)
    try {
      // Erstelle einen Testton (440 Hz - A Note)
      const audioContext = new AudioContext()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)

      oscillator.frequency.value = 440
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1)

      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 1)

      setTimeout(() => {
        audioContext.close()
        setIsTesting(false)
        alert("Testton abgespielt. Hast du einen Ton gehört?")
      }, 1000)
    } catch (error) {
      console.error("Failed to test speaker:", error)
      setIsTesting(false)
      alert("Fehler beim Testen des Lautsprechers.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>Einstellungen</DialogTitle>
          <DialogDescription>
            Passe deine Audioeinstellungen und andere Optionen an
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="audio" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="audio">Audio</TabsTrigger>
            <TabsTrigger value="general">Allgemein</TabsTrigger>
          </TabsList>

          <TabsContent value="audio" className="space-y-6">
            {/* Eingabegerät */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Mic className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="input-device" className="font-semibold">
                  Eingabegerät (Mikrofon)
                </Label>
              </div>
              <Select value={audioSettings.inputDevice} onValueChange={handleInputDeviceChange}>
                <SelectTrigger id="input-device">
                  <SelectValue placeholder="Wähle ein Eingabegerät" />
                </SelectTrigger>
                <SelectContent>
                  {inputDevices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || `Eingabegerät ${inputDevices.indexOf(device) + 1}`}
                    </SelectItem>
                  ))}
                  {inputDevices.length === 0 && (
                    <SelectItem value="default" disabled>
                      Keine Geräte gefunden
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={testMicrophone}
                disabled={isTesting || inputDevices.length === 0}
                className="w-full"
              >
                {isTesting ? "Teste..." : "Mikrofon testen"}
              </Button>
            </div>

            {/* Eingabe-Lautstärke */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="input-volume">Mikrofon-Lautstärke</Label>
                <span className="text-sm font-medium text-muted-foreground">
                  {audioSettings.inputVolume}%
                </span>
              </div>
              <Slider
                id="input-volume"
                min={0}
                max={100}
                step={1}
                value={[audioSettings.inputVolume]}
                onValueChange={handleInputVolumeChange}
                className="w-full"
              />
            </div>

            {/* Ausgabegerät */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Headphones className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="output-device" className="font-semibold">
                  Ausgabegerät (Lautsprecher)
                </Label>
              </div>
              <Select value={audioSettings.outputDevice} onValueChange={handleOutputDeviceChange}>
                <SelectTrigger id="output-device">
                  <SelectValue placeholder="Wähle ein Ausgabegerät" />
                </SelectTrigger>
                <SelectContent>
                  {outputDevices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || `Ausgabegerät ${outputDevices.indexOf(device) + 1}`}
                    </SelectItem>
                  ))}
                  {outputDevices.length === 0 && (
                    <SelectItem value="default" disabled>
                      Keine Geräte gefunden
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={testSpeaker}
                disabled={isTesting || outputDevices.length === 0}
                className="w-full"
              >
                {isTesting ? "Teste..." : "Lautsprecher testen"}
              </Button>
            </div>

            {/* Ausgabe-Lautstärke */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="output-volume">Lautsprecher-Lautstärke</Label>
                <span className="text-sm font-medium text-muted-foreground">
                  {audioSettings.outputVolume}%
                </span>
              </div>
              <Slider
                id="output-volume"
                min={0}
                max={100}
                step={1}
                value={[audioSettings.outputVolume]}
                onValueChange={handleOutputVolumeChange}
                className="w-full"
              />
            </div>
          </TabsContent>

          <TabsContent value="general" className="space-y-4">
            <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
              <p>Weitere Einstellungen sind in Kürze verfügbar.</p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}


