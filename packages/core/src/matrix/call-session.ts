/**
 * CallSession
 * One active voice/video call in a room: the MatrixRTC membership (who is in the call,
 * media key exchange) plus the LiveKit connection (actual media through the SFU).
 * Framework-agnostic; React subscribes through subscribe()/getSnapshot().
 */

import {
  BaseKeyProvider,
  ConnectionQuality,
  ConnectionState,
  DisconnectReason,
  LogLevel,
  Room as LivekitRoom,
  RoomEvent as LivekitRoomEvent,
  setLogLevel,
  Track,
  TrackEvent,
  VideoPresets,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type VideoTrack,
} from 'livekit-client'
import { EventType, type MatrixClient } from 'matrix-js-sdk'
import {
  MatrixRTCSessionEvent,
  type CallMembership,
  type MatrixRTCSession,
} from 'matrix-js-sdk/lib/matrixrtc/index.js'
import {
  CallPermissionError,
  canJoinCalls,
  discoverLivekitServiceUrl,
  getSfuConfig,
  ownLivekitTransport,
  selectActiveServiceUrl,
  userIdFromIdentity,
} from './rtc'
import {
  screenShareBitrate,
  screenShareConstraints,
  screenShareTuning,
  type ScreenShareQuality,
} from '../screenshare-quality'
import {
  createEncoderSampler,
  evenScale,
  installH264MainProfilePreference,
  preferredVideoCodec,
  type EncoderInfo,
} from '../video-codec'
import { createConnectionSampler, type ConnectionInfo } from '../connection-stats'
import { t } from '@nexspeak/i18n'

export const LIVEKIT_E2EE_WORKER_URL = '/livekit-e2ee-worker.mjs'
const LEAVE_TIMEOUT_MS = 5000
/** Upper bound for waiting on our own media key before publishing anyway. */
const OWN_KEY_TIMEOUT_MS = 10_000
// How often a running screenshare checks whether the shared window changed size.
const SCREENSHARE_SIZE_CHECK_MS = 2_000
// After a full reconnect LiveKit announces everyone and their tracks again: no sound cues for that.
const RECONNECT_CUE_QUIET_MS = 2_000

/** Verbose call logging, enabled with localStorage["nexspeak:debug"] = "1". */
function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem('nexspeak:debug') === '1'
  } catch {
    return false
  }
}

function debug(...args: unknown[]): void {
  if (isDebugEnabled()) console.info('[call]', ...args)
}

export interface CallParticipant {
  identity: string
  userId: string
  name: string
  avatarMxc?: string
  isLocal: boolean
  /** In the MatrixRTC session but not (yet) connected to the SFU. */
  isConnecting: boolean
  isSpeaking: boolean
  isMicMuted: boolean
  isScreensharing: boolean
  /** We subscribed to this participant's screenshare ("Watch stream"); remote participants only. */
  isWatchingScreenshare: boolean
  /** Local playback volume for this participant, 0..1. */
  volume: number
  /** Muted locally, only for us. */
  isLocallyMuted: boolean
}

export interface CallVideoFeed {
  id: string
  /** LiveKit identity of the publishing participant. */
  identity: string
  userId: string
  name: string
  track: VideoTrack
  isScreenshare: boolean
  isLocal: boolean
}

/** Stable id of a participant's camera or screenshare, also before the track arrives. */
export function videoFeedId(identity: string, isScreenshare: boolean): string {
  return `${identity}-${isScreenshare ? Track.Source.ScreenShare : Track.Source.Camera}`
}

/** Screenshares are only downloaded on request ("Watch stream"); everything else automatically. */
function isScreenshareSource(source: Track.Source): boolean {
  return source === Track.Source.ScreenShare || source === Track.Source.ScreenShareAudio
}

/** Discord-like sound cues; CallSession reports them, the app decides whether and how to play them. */
export type CallCue =
  | 'self-join'
  | 'self-leave'
  | 'participant-join'
  | 'participant-leave'
  | 'screenshare-start'
  | 'screenshare-stop'

export type CallConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
/** Our connection quality as rated by the SFU. */
export type CallConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'

export interface CallSnapshot {
  roomId: string
  connectionState: CallConnectionState
  connectionQuality: CallConnectionQuality
  isEncrypted: boolean
  participants: CallParticipant[]
  videoFeeds: CallVideoFeed[]
  isMicMuted: boolean
  isCameraOn: boolean
  isScreensharing: boolean
  isDeafened: boolean
  /** The browser blocked autoplay; a user gesture has to call startAudio(). */
  isAudioBlocked: boolean
}

function toConnectionQuality(quality: ConnectionQuality): CallConnectionQuality {
  switch (quality) {
    case ConnectionQuality.Excellent:
      return 'excellent'
    case ConnectionQuality.Good:
      return 'good'
    case ConnectionQuality.Poor:
      return 'poor'
    case ConnectionQuality.Lost:
      return 'lost'
    default:
      return 'unknown'
  }
}

export interface CallAudioOptions {
  inputDeviceId: string
  outputDeviceId: string
  /** 0..1 */
  outputVolume: number
  /** Join with the microphone off / sound off (the user's self-mute preference). */
  startMuted?: boolean
  startDeafened?: boolean
  /** Push-to-talk mode: the microphone only transmits while setPushToTalkPressed(true). */
  pushToTalk?: boolean
  /** Called for sound cues (never while deafened, nor for the people already there when we join). */
  onCue?: (cue: CallCue) => void
}

/** Feeds MatrixRTC media keys into LiveKit's per-participant frame encryption. */
class MatrixKeyProvider extends BaseKeyProvider {
  constructor() {
    super({ ratchetWindowSize: 10, keyringSize: 256 })
  }

  /** Resolves true once the key is handed to LiveKit. */
  setMediaKey(key: Uint8Array<ArrayBuffer>, index: number, participantIdentity: string): Promise<boolean> {
    return crypto.subtle
      .importKey('raw', key, 'HKDF', false, ['deriveBits', 'deriveKey'])
      .then((material) => {
        this.onSetEncryptionKey(material, participantIdentity, index)
        return true
      })
      .catch((error: unknown) => {
        console.error('Failed to import call media key:', error)
        return false
      })
  }
}

type Listener = () => void

export class CallSession {
  readonly roomId: string
  readonly isEncrypted: boolean

  private readonly listeners = new Set<Listener>()
  private snapshot: CallSnapshot
  private snapshotDirty = true
  private connectionState: CallConnectionState = 'connecting'
  private isDeafened: boolean
  private outputVolume: number
  private readonly startMuted: boolean
  private pushToTalk: boolean
  private pushToTalkPressed = false
  /** Per-participant playback volume (0..1) and local mutes, by identity. */
  private readonly participantVolumes = new Map<string, number>()
  private readonly locallyMuted = new Set<string>()
  private readonly audioElements = new Map<string, HTMLMediaElement>()
  private readonly audioContainer: HTMLDivElement
  private isLeaving = false
  private hasConnected = false
  private readonly onCue?: (cue: CallCue) => void
  private cuesQuietUntil = 0
  private readonly cleanups: Array<() => void> = []

  /**
   * Resolves once our own media key is in LiveKit. The SDK only creates it after our call
   * membership came back from the homeserver; frames sent before that can't be encrypted
   * (LiveKit: "MissingKey ... at index 0") and are dropped.
   */
  private readonly ownKeyReady: Promise<void>
  private resolveOwnKey: () => void = () => {}

  /** Called once when the session ends for any reason (left, kicked, connection lost). */
  onEnded?: (reason: string | null) => void

  private constructor(
    private readonly rtcSession: MatrixRTCSession,
    private readonly livekitRoom: LivekitRoom,
    private readonly keyProvider: MatrixKeyProvider | null,
    private readonly ownIdentity: string,
    audio: CallAudioOptions,
  ) {
    this.ownKeyReady = keyProvider
      ? new Promise((resolve) => {
          this.resolveOwnKey = resolve
        })
      : Promise.resolve()
    this.roomId = rtcSession.room.roomId
    this.isEncrypted = keyProvider !== null
    this.outputVolume = audio.outputVolume
    this.isDeafened = audio.startDeafened ?? false
    this.startMuted = audio.startMuted ?? false
    this.pushToTalk = audio.pushToTalk ?? false
    this.onCue = audio.onCue
    this.audioContainer = document.createElement('div')
    this.audioContainer.hidden = true
    document.body.appendChild(this.audioContainer)
    this.snapshot = this.buildSnapshot()
  }

  static async start(client: MatrixClient, roomId: string, audio: CallAudioOptions): Promise<CallSession> {
    const room = client.getRoom(roomId)
    if (!room) throw new Error(t('error.roomNotFound'))

    const userId = client.getUserId() ?? ''
    if (!canJoinCalls(room, userId)) {
      throw new CallPermissionError(room.currentState.maySendStateEvent(EventType.RoomPowerLevels, userId))
    }

    setLogLevel(isDebugEnabled() ? LogLevel.debug : LogLevel.warn)

    const rtcSession = client.matrixRTC.getRoomSession(room)
    const ownServiceUrl = await discoverLivekitServiceUrl(client)
    const serviceUrl = selectActiveServiceUrl(rtcSession.memberships, rtcSession.getOldestMembership(), ownServiceUrl)
    debug('using LiveKit service', serviceUrl, 'members:', rtcSession.memberships.length)
    const sfu = await getSfuConfig(client, serviceUrl, roomId)
    debug('got SFU config', sfu.url)

    installH264MainProfilePreference()

    // Media is end-to-end encrypted exactly when the room is, like Element Call does.
    const keyProvider = room.hasEncryptionStateEvent() ? new MatrixKeyProvider() : null
    const livekitRoom = new LivekitRoom({
      // Size subscriptions in device pixels: on Retina/HiDPI screens the default (CSS pixels)
      // picks the half-resolution layer and a shared screen looks blurry.
      adaptiveStream: { pixelDensity: 'screen' },
      dynacast: true,
      publishDefaults: {
        // H.264 is hardware-encoded on macOS and NVIDIA/AMD/Intel GPUs: little load while gaming.
        videoCodec: preferredVideoCodec(),
        // One extra camera layer instead of LiveKit's two: every layer is a separate encoder
        // (and hardware encoder session).
        videoSimulcastLayers: [VideoPresets.h360],
      },
      audioCaptureDefaults: {
        // A preference, not a requirement: a remembered device may be unplugged by now.
        deviceId: audio.inputDeviceId ? { ideal: audio.inputDeviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      audioOutput: audio.outputDeviceId ? { deviceId: audio.outputDeviceId } : undefined,
      e2ee: keyProvider
        ? { keyProvider, worker: new Worker(LIVEKIT_E2EE_WORKER_URL, { type: 'module' }) }
        : undefined,
    })

    const ownIdentity = `${userId}:${client.getDeviceId() ?? ''}`
    const session = new CallSession(rtcSession, livekitRoom, keyProvider, ownIdentity, audio)
    try {
      await session.connect(serviceUrl, sfu)
    } catch (error) {
      await session.leave()
      throw error
    }
    return session
  }

  private async connect(serviceUrl: string, sfu: { url: string; jwt: string }): Promise<void> {
    this.attachListeners()

    if (this.keyProvider) await this.livekitRoom.setE2EEEnabled(true)
    debug('joining MatrixRTC session, e2ee:', this.isEncrypted)

    this.rtcSession.joinRoomSession([ownLivekitTransport(serviceUrl, this.roomId)], undefined, {
      manageMediaKeys: this.isEncrypted,
      useExperimentalToDeviceTransport: true,
      callIntent: 'audio',
    })

    // Nothing is subscribed by default, so remote screenshares cost no bandwidth or decoding
    // until someone watches them; camera and audio are subscribed in subscribeByDefault().
    await this.livekitRoom.connect(sfu.url, sfu.jwt, { autoSubscribe: false })
    debug('connected to SFU')
    // TrackPublished only fires for tracks published after we joined.
    this.livekitRoom.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => this.subscribeByDefault(publication, participant))
    })
    this.connectionState = 'connected'
    this.hasConnected = true
    this.changed()
    this.cue('self-join')

    // Publish in the background: in encrypted calls this waits for our media key.
    if (!this.startMuted) void this.publishInitialMicrophone()
  }

  private async publishInitialMicrophone(): Promise<void> {
    try {
      await this.setMicrophoneEnabled(true)
      debug('microphone published')
    } catch (error) {
      // Joining without a microphone (denied or missing) is still useful for listening.
      console.warn('Microphone unavailable:', error)
    }
  }

  /** Publishing before our key exists would send nothing but undecryptable frames. */
  private async waitForOwnKey(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), OWN_KEY_TIMEOUT_MS)
    })
    const result = await Promise.race([this.ownKeyReady, timeout])
    clearTimeout(timer)
    if (result === 'timeout') console.warn('Own call media key not available yet; publishing anyway.')
  }

  private subscribeByDefault(publication: RemoteTrackPublication, participant: RemoteParticipant): void {
    if (publication.isDesired) return
    if (!isScreenshareSource(publication.source)) {
      publication.setSubscribed(true)
    } else if (publication.source === Track.Source.ScreenShareAudio) {
      // The stream's audio may be published after the viewer pressed "Watch stream".
      if (participant.getTrackPublication(Track.Source.ScreenShare)?.isDesired) publication.setSubscribed(true)
    }
  }

  private attachListeners(): void {
    const room = this.livekitRoom
    const changed = () => this.changed()
    const onTrackPublished = (publication: RemoteTrackPublication, participant: RemoteParticipant) =>
      this.subscribeByDefault(publication, participant)

    const onTrackSubscribed = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        const element = track.attach()
        this.audioElements.set(track.sid ?? element.id, element)
        this.audioContainer.appendChild(element)
        this.applyRemoteVolume()
      }
      this.changed()
    }
    const onTrackUnsubscribed = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach().forEach((element) => element.remove())
        if (track.sid) this.audioElements.delete(track.sid)
      }
      this.changed()
    }
    const onConnectionStateChanged = (state: ConnectionState) => {
      if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) {
        this.connectionState = 'reconnecting'
      } else if (state === ConnectionState.Connected) {
        if (this.connectionState === 'reconnecting') this.cuesQuietUntil = Date.now() + RECONNECT_CUE_QUIET_MS
        this.connectionState = 'connected'
      }
      this.changed()
    }
    const onDisconnected = (reason?: DisconnectReason) => {
      if (this.isLeaving) return
      const message =
        reason === DisconnectReason.DUPLICATE_IDENTITY
          ? t('call.error.duplicateIdentity')
          : t('call.error.disconnected')
      void this.leave(message)
    }

    room.on(LivekitRoomEvent.TrackPublished, onTrackPublished)
    room.on(LivekitRoomEvent.TrackSubscribed, onTrackSubscribed)
    room.on(LivekitRoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
    room.on(LivekitRoomEvent.ConnectionStateChanged, onConnectionStateChanged)
    room.on(LivekitRoomEvent.Disconnected, onDisconnected)
    const simpleEvents = [
      LivekitRoomEvent.ParticipantConnected,
      LivekitRoomEvent.ParticipantDisconnected,
      LivekitRoomEvent.TrackMuted,
      LivekitRoomEvent.TrackUnmuted,
      LivekitRoomEvent.TrackPublished,
      LivekitRoomEvent.TrackUnpublished,
      LivekitRoomEvent.LocalTrackPublished,
      LivekitRoomEvent.LocalTrackUnpublished,
      LivekitRoomEvent.ActiveSpeakersChanged,
      LivekitRoomEvent.AudioPlaybackStatusChanged,
      LivekitRoomEvent.ParticipantNameChanged,
    ] as const
    simpleEvents.forEach((event) => room.on(event, changed))

    // LiveKit enables the microphone track again on publish, unmute and restart (device change).
    const gateMicrophone = () => this.applyTransmitGate()
    const onLocalTrackPublished = (publication: LocalTrackPublication) => {
      if (publication.source !== Track.Source.Microphone) return
      publication.track?.on(TrackEvent.Restarted, gateMicrophone)
      gateMicrophone()
    }
    room.on(LivekitRoomEvent.LocalTrackPublished, onLocalTrackPublished)
    room.on(LivekitRoomEvent.TrackUnmuted, gateMicrophone)

    // The SFU pushes quality updates, so the signal icon needs no stats polling.
    const onConnectionQualityChanged = (_quality: ConnectionQuality, participant: Participant) => {
      if (participant === room.localParticipant) this.changed()
    }
    room.on(LivekitRoomEvent.ConnectionQualityChanged, onConnectionQualityChanged)

    // Participants already in the call when we join don't fire ParticipantConnected.
    const onParticipantConnected = () => this.cue('participant-join')
    const onParticipantDisconnected = () => this.cue('participant-leave')
    const onRemoteScreenshareStarted = (publication: RemoteTrackPublication) => {
      if (publication.source === Track.Source.ScreenShare) this.cue('screenshare-start')
    }
    const onRemoteScreenshareStopped = (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      // A participant who leaves unpublishes everything first; their leave cue is enough.
      if (publication.source !== Track.Source.ScreenShare) return
      if (room.remoteParticipants.get(participant.identity) === participant) this.cue('screenshare-stop')
    }
    const onLocalScreenshareCue = (publication: LocalTrackPublication, started: boolean) => {
      if (publication.source === Track.Source.ScreenShare) this.cue(started ? 'screenshare-start' : 'screenshare-stop')
    }
    const onLocalScreenshareStarted = (publication: LocalTrackPublication) => onLocalScreenshareCue(publication, true)
    const onLocalScreenshareStopped = (publication: LocalTrackPublication) => onLocalScreenshareCue(publication, false)
    room.on(LivekitRoomEvent.ParticipantConnected, onParticipantConnected)
    room.on(LivekitRoomEvent.ParticipantDisconnected, onParticipantDisconnected)
    room.on(LivekitRoomEvent.TrackPublished, onRemoteScreenshareStarted)
    room.on(LivekitRoomEvent.TrackUnpublished, onRemoteScreenshareStopped)
    room.on(LivekitRoomEvent.LocalTrackPublished, onLocalScreenshareStarted)
    room.on(LivekitRoomEvent.LocalTrackUnpublished, onLocalScreenshareStopped)

    const onKey = (key: Uint8Array<ArrayBuffer>, index: number, _membership: unknown, rtcBackendIdentity: string) => {
      void this.keyProvider?.setMediaKey(key, index, rtcBackendIdentity).then((imported) => {
        if (imported && rtcBackendIdentity === this.ownIdentity) this.resolveOwnKey()
      })
    }
    const onManagerError = (error: unknown) => {
      console.error('MatrixRTC membership error:', error)
      void this.leave(t('call.error.membershipLost'))
    }
    this.rtcSession.on(MatrixRTCSessionEvent.EncryptionKeyChanged, onKey)
    this.rtcSession.on(MatrixRTCSessionEvent.MembershipsChanged, changed)
    this.rtcSession.on(MatrixRTCSessionEvent.MembershipManagerError, onManagerError)

    this.cleanups.push(() => {
      room.off(LivekitRoomEvent.TrackPublished, onTrackPublished)
      room.off(LivekitRoomEvent.TrackSubscribed, onTrackSubscribed)
      room.off(LivekitRoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
      room.off(LivekitRoomEvent.ConnectionStateChanged, onConnectionStateChanged)
      room.off(LivekitRoomEvent.Disconnected, onDisconnected)
      simpleEvents.forEach((event) => room.off(event, changed))
      room.off(LivekitRoomEvent.LocalTrackPublished, onLocalTrackPublished)
      room.off(LivekitRoomEvent.TrackUnmuted, gateMicrophone)
      room.off(LivekitRoomEvent.ConnectionQualityChanged, onConnectionQualityChanged)
      room.off(LivekitRoomEvent.ParticipantConnected, onParticipantConnected)
      room.off(LivekitRoomEvent.ParticipantDisconnected, onParticipantDisconnected)
      room.off(LivekitRoomEvent.TrackPublished, onRemoteScreenshareStarted)
      room.off(LivekitRoomEvent.TrackUnpublished, onRemoteScreenshareStopped)
      room.off(LivekitRoomEvent.LocalTrackPublished, onLocalScreenshareStarted)
      room.off(LivekitRoomEvent.LocalTrackUnpublished, onLocalScreenshareStopped)
      this.rtcSession.off(MatrixRTCSessionEvent.EncryptionKeyChanged, onKey)
      this.rtcSession.off(MatrixRTCSessionEvent.MembershipsChanged, changed)
      this.rtcSession.off(MatrixRTCSessionEvent.MembershipManagerError, onManagerError)
    })
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): CallSnapshot => {
    if (this.snapshotDirty) {
      this.snapshot = this.buildSnapshot()
      this.snapshotDirty = false
    }
    return this.snapshot
  }

  private changed(): void {
    this.snapshotDirty = true
    this.listeners.forEach((listener) => listener())
  }

  /**
   * Checked a microtask later: on a full reconnect LiveKit first drops every participant (and we
   * republish our tracks) and only then reports the reconnect.
   */
  private cue(cue: CallCue): void {
    if (!this.onCue) return
    queueMicrotask(() => {
      if (this.connectionState !== 'connected' || this.isDeafened || Date.now() < this.cuesQuietUntil) return
      this.onCue?.(cue)
    })
  }

  private memberName(userId: string): { name: string; avatarMxc?: string } {
    const member = this.rtcSession.room.getMember(userId)
    return { name: member?.name || userId, avatarMxc: member?.getMxcAvatarUrl() || undefined }
  }

  private toParticipant(participant: Participant, isLocal: boolean): CallParticipant {
    const userId = userIdFromIdentity(participant.identity)
    return {
      identity: participant.identity,
      userId,
      ...this.memberName(userId),
      isLocal,
      isConnecting: false,
      isSpeaking: participant.isSpeaking,
      isMicMuted: !participant.isMicrophoneEnabled,
      isScreensharing: participant.isScreenShareEnabled,
      isWatchingScreenshare:
        !isLocal &&
        ((participant as RemoteParticipant).getTrackPublication(Track.Source.ScreenShare)?.isDesired ?? false),
      volume: this.participantVolumes.get(participant.identity) ?? 1,
      isLocallyMuted: this.locallyMuted.has(participant.identity),
    }
  }

  private buildSnapshot(): CallSnapshot {
    const room = this.livekitRoom
    const local = room.localParticipant
    const connected = [local, ...room.remoteParticipants.values()]
    const byIdentity = new Map<string, CallParticipant>()

    connected.forEach((participant) => {
      byIdentity.set(participant.identity, this.toParticipant(participant, participant === local))
    })

    // Members announced via MatrixRTC who haven't reached the SFU yet.
    this.rtcSession.memberships.forEach((membership: CallMembership) => {
      const identity = `${membership.sender}:${membership.deviceId}`
      if (byIdentity.has(identity)) return
      byIdentity.set(identity, {
        identity,
        userId: membership.sender,
        ...this.memberName(membership.sender),
        isLocal: false,
        isConnecting: true,
        isSpeaking: false,
        isMicMuted: true,
        isScreensharing: false,
        isWatchingScreenshare: false,
        volume: this.participantVolumes.get(identity) ?? 1,
        isLocallyMuted: this.locallyMuted.has(identity),
      })
    })

    const videoFeeds: CallVideoFeed[] = []
    connected.forEach((participant) => {
      const userId = userIdFromIdentity(participant.identity)
      const { name } = this.memberName(userId)
      const isLocal = participant === local
      for (const source of [Track.Source.ScreenShare, Track.Source.Camera]) {
        const publication = participant.getTrackPublication(source)
        const track = publication?.videoTrack
        if (!track || publication.isMuted) continue
        // After "Stop watching" LiveKit keeps the track until the SFU removed it; it shows no more frames.
        if (!isLocal && !(publication as RemoteTrackPublication).isDesired) continue
        videoFeeds.push({
          id: videoFeedId(participant.identity, source === Track.Source.ScreenShare),
          identity: participant.identity,
          userId,
          name,
          track,
          isScreenshare: source === Track.Source.ScreenShare,
          isLocal,
        })
      }
    })
    // Screenshares first: they are what people want to look at.
    videoFeeds.sort((a, b) => Number(b.isScreenshare) - Number(a.isScreenshare) || Number(a.isLocal) - Number(b.isLocal))

    return {
      roomId: this.roomId,
      connectionState: this.connectionState,
      connectionQuality: toConnectionQuality(local.connectionQuality),
      isEncrypted: this.isEncrypted,
      participants: Array.from(byIdentity.values()).sort(
        (a, b) => Number(b.isLocal) - Number(a.isLocal) || a.name.localeCompare(b.name),
      ),
      videoFeeds,
      isMicMuted: !local.isMicrophoneEnabled,
      isCameraOn: local.isCameraEnabled,
      isScreensharing: local.isScreenShareEnabled,
      isDeafened: this.isDeafened,
      isAudioBlocked: !room.canPlaybackAudio,
    }
  }

  private applyRemoteVolume(): void {
    this.livekitRoom.remoteParticipants.forEach((participant) => {
      const muted = this.isDeafened || this.locallyMuted.has(participant.identity)
      const volume = muted ? 0 : this.outputVolume * (this.participantVolumes.get(participant.identity) ?? 1)
      participant.setVolume(volume, Track.Source.Microphone)
      participant.setVolume(volume, Track.Source.ScreenShareAudio)
    })
  }

  /**
   * Discord's per-user volume: only changes what we hear. Capped at 1, because without
   * LiveKit's WebAudio mix the volume goes straight to the audio element.
   */
  setParticipantVolume(identity: string, volume: number): void {
    this.participantVolumes.set(identity, Math.min(1, Math.max(0, volume)))
    this.applyRemoteVolume()
    this.changed()
  }

  /** Discord's "Watch stream" / "Stop watching": subscribes to a remote screenshare and its audio, or stops. */
  setScreenshareWatched(identity: string, watched: boolean): void {
    const participant = this.livekitRoom.remoteParticipants.get(identity)
    if (!participant) return
    for (const source of [Track.Source.ScreenShare, Track.Source.ScreenShareAudio]) {
      participant.getTrackPublication(source)?.setSubscribed(watched)
    }
    this.changed()
  }

  setParticipantMuted(identity: string, muted: boolean): void {
    if (muted) this.locallyMuted.add(identity)
    else this.locallyMuted.delete(identity)
    this.applyRemoteVolume()
    this.changed()
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (enabled) await this.waitForOwnKey()
    if (this.isLeaving) return
    await this.livekitRoom.localParticipant.setMicrophoneEnabled(enabled)
    this.applyTransmitGate()
    this.changed()
  }

  /** Push-to-talk mode on or off; off transmits whenever the microphone is unmuted. */
  setPushToTalk(enabled: boolean): void {
    this.pushToTalk = enabled
    this.applyTransmitGate()
  }

  setPushToTalkPressed(pressed: boolean): void {
    this.pushToTalkPressed = pressed
    this.applyTransmitGate()
  }

  /**
   * Push-to-talk gates the microphone track instead of muting it: others don't see us as muted,
   * and with Opus DTX a disabled track sends practically nothing.
   */
  private applyTransmitGate(): void {
    const track = this.livekitRoom.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
    if (!track || track.isMuted) return
    track.mediaStreamTrack.enabled = !this.pushToTalk || this.pushToTalkPressed
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (enabled) await this.waitForOwnKey()
    if (this.isLeaving) return
    await this.livekitRoom.localParticipant.setCameraEnabled(enabled)
    this.changed()
  }

  async setScreenShareEnabled(enabled: boolean, quality?: ScreenShareQuality, shareAudio = true): Promise<void> {
    if (enabled) await this.waitForOwnKey()
    if (this.isLeaving) return
    if (!enabled || !quality) {
      await this.livekitRoom.localParticipant.setScreenShareEnabled(enabled, {
        audio: shareAudio,
        systemAudio: shareAudio ? 'include' : 'exclude',
      })
      this.changed()
      return
    }
    const tuning = screenShareTuning(quality)
    await this.livekitRoom.localParticipant.setScreenShareEnabled(
      true,
      {
        audio: shareAudio,
        systemAudio: shareAudio ? 'include' : 'exclude',
        // Our own constraints instead of LiveKit's `resolution`, which drops the frame
        // rate when the resolution is uncapped and asks for an ideal (upscaled) size.
        resolution: { width: 0, height: 0 },
        video: screenShareConstraints(quality) as { displaySurface?: 'window' | 'browser' | 'monitor' },
        contentHint: tuning.contentHint || undefined,
      },
      {
        // LiveKit's default is 1080p at 15 fps and 2.5 Mbit/s: too choppy for games.
        screenShareEncoding: { maxBitrate: screenShareBitrate(quality), maxFramerate: quality.fps, priority: 'high' },
        degradationPreference: tuning.degradationPreference,
      },
    )
    this.screenShareQuality = quality
    await this.applyScreenShareEncodings()
    this.watchScreenShareSize()
    this.changed()
  }

  private screenShareQuality: ScreenShareQuality | null = null
  private screenShareSize = ''
  private screenShareSizeTimer: ReturnType<typeof setInterval> | undefined

  private screenShareTrack(): LocalVideoTrack | undefined {
    return this.livekitRoom.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track as
      | LocalVideoTrack
      | undefined
  }

  /**
   * Bitrate, frame rate and scaling of all screenshare layers. Scaling keeps every layer at an
   * even size, otherwise hardware H.264 encoders refuse it and the browser encodes in software.
   */
  private async applyScreenShareEncodings(): Promise<void> {
    const track = this.screenShareTrack()
    const sender = track?.sender
    const quality = this.screenShareQuality
    if (!track || !sender || !quality) return
    const { width = 0, height = 0 } = track.mediaStreamTrack.getSettings()
    this.screenShareSize = `${width}x${height}`
    const params = sender.getParameters()
    if (!params.encodings?.length) return
    const bitrate = screenShareBitrate(quality)
    for (const encoding of params.encodings) {
      // 1 for the full layer, 2 for the half-resolution simulcast layer (before our tweak).
      const layerScale = Math.max(1, Math.round(encoding.scaleResolutionDownBy ?? 1))
      encoding.scaleResolutionDownBy = evenScale(width, height, layerScale)
      // Simulcast layers are downscaled copies; scale their budget with the pixel count.
      encoding.maxBitrate = Math.max(150_000, Math.round(bitrate / (layerScale * layerScale)))
      encoding.maxFramerate = quality.fps
    }
    await sender.setParameters(params)
  }

  /** The shared window can be resized at any time; keep the encoder sizes even. */
  private watchScreenShareSize(): void {
    clearInterval(this.screenShareSizeTimer)
    this.screenShareSizeTimer = setInterval(() => {
      const track = this.screenShareTrack()
      if (!track) {
        clearInterval(this.screenShareSizeTimer)
        return
      }
      const { width = 0, height = 0 } = track.mediaStreamTrack.getSettings()
      if (`${width}x${height}` !== this.screenShareSize) {
        void this.applyScreenShareEncodings().catch((error: unknown) => console.warn('Updating screenshare encodings failed', error))
      }
    }, SCREENSHARE_SIZE_CHECK_MS)
  }

  /** Stats sampler for the running screenshare's encoder, or null when not sharing. */
  createScreenShareEncoderSampler(): (() => Promise<EncoderInfo | null>) | null {
    const sender = this.livekitRoom.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.sender
    return sender ? createEncoderSampler(sender) : null
  }

  /** Stats sampler for ping, packet loss and transport of the connections to the SFU. */
  createConnectionSampler(): () => Promise<ConnectionInfo | null> {
    return createConnectionSampler(async () => {
      // engine is marked internal, but it is the only way to the peer connections' stats.
      const transports = this.livekitRoom.engine.pcManager
      if (!transports) return []
      const reports = await Promise.all([transports.publisher.getStats(), transports.subscriber?.getStats()])
      return reports.filter((report): report is RTCStatsReport => report !== undefined)
    })
  }

  /** Change resolution and frame rate of a running screenshare without a new picker. */
  async setScreenShareQuality(quality: ScreenShareQuality): Promise<void> {
    const track = this.screenShareTrack()
    if (!track) return
    const tuning = screenShareTuning(quality)
    track.mediaStreamTrack.contentHint = tuning.contentHint
    await track.mediaStreamTrack.applyConstraints(screenShareConstraints(quality))
    this.screenShareQuality = quality
    await this.applyScreenShareEncodings()
    await track.setDegradationPreference(tuning.degradationPreference)
    this.changed()
  }

  setDeafened(deafened: boolean): void {
    this.isDeafened = deafened
    this.applyRemoteVolume()
    this.changed()
  }

  setOutputVolume(volume: number): void {
    this.outputVolume = volume
    this.applyRemoteVolume()
  }

  async setDevice(kind: 'audioinput' | 'audiooutput', deviceId: string): Promise<void> {
    const target = deviceId || 'default'
    if (this.livekitRoom.getActiveDevice(kind) === target) return
    // Not exact: LiveKit would otherwise keep requiring this device, and every later unmute
    // fails with "Constraints could not be satisfied" once it is gone.
    await this.livekitRoom.switchActiveDevice(kind, target, false)
    if (kind === 'audioinput') this.applyTransmitGate()
  }

  async startAudio(): Promise<void> {
    await this.livekitRoom.startAudio()
    this.changed()
  }

  /** Leave the call. Safe to call multiple times. */
  async leave(reason: string | null = null): Promise<void> {
    if (this.isLeaving) return
    this.isLeaving = true
    this.connectionState = 'disconnected'
    if (this.hasConnected && !this.isDeafened) this.onCue?.('self-leave')

    this.cleanups.forEach((cleanup) => cleanup())
    this.cleanups.length = 0
    clearInterval(this.screenShareSizeTimer)

    await Promise.allSettled([
      this.livekitRoom.disconnect(),
      this.rtcSession.isJoined() ? this.rtcSession.leaveRoomSession(LEAVE_TIMEOUT_MS) : Promise.resolve(true),
    ])

    this.audioElements.forEach((element) => element.remove())
    this.audioElements.clear()
    this.audioContainer.remove()
    this.changed()
    this.onEnded?.(reason)
  }
}
