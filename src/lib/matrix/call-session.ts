/**
 * CallSession
 * One active voice/video call in a room: the MatrixRTC membership (who is in the call,
 * media key exchange) plus the LiveKit connection (actual media through the SFU).
 * Framework-agnostic; React subscribes through subscribe()/getSnapshot().
 */

import {
  BaseKeyProvider,
  ConnectionState,
  DisconnectReason,
  LogLevel,
  Room as LivekitRoom,
  RoomEvent as LivekitRoomEvent,
  setLogLevel,
  Track,
  type Participant,
  type RemoteTrack,
  type VideoTrack,
} from 'livekit-client'
import { EventType, type MatrixClient } from 'matrix-js-sdk'
import {
  MatrixRTCSessionEvent,
  type CallMembership,
  type MatrixRTCSession,
} from 'matrix-js-sdk/lib/matrixrtc'
import {
  CallPermissionError,
  canJoinCalls,
  discoverLivekitServiceUrl,
  getSfuConfig,
  ownLivekitTransport,
  selectActiveServiceUrl,
  userIdFromIdentity,
} from '@/lib/matrix/rtc'

export const LIVEKIT_E2EE_WORKER_URL = '/livekit-e2ee-worker.mjs'
const LEAVE_TIMEOUT_MS = 5000
/** Upper bound for waiting on our own media key before publishing anyway. */
const OWN_KEY_TIMEOUT_MS = 10_000

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

export type CallConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface CallSnapshot {
  roomId: string
  connectionState: CallConnectionState
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

export interface CallAudioOptions {
  inputDeviceId: string
  outputDeviceId: string
  /** 0..1 */
  outputVolume: number
  /** Join with the microphone off / sound off (the user's self-mute preference). */
  startMuted?: boolean
  startDeafened?: boolean
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
  /** Per-participant playback volume (0..1) and local mutes, by identity. */
  private readonly participantVolumes = new Map<string, number>()
  private readonly locallyMuted = new Set<string>()
  private readonly audioElements = new Map<string, HTMLMediaElement>()
  private readonly audioContainer: HTMLDivElement
  private isLeaving = false
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
    this.audioContainer = document.createElement('div')
    this.audioContainer.hidden = true
    document.body.appendChild(this.audioContainer)
    this.snapshot = this.buildSnapshot()
  }

  static async start(client: MatrixClient, roomId: string, audio: CallAudioOptions): Promise<CallSession> {
    const room = client.getRoom(roomId)
    if (!room) throw new Error('Raum nicht gefunden.')

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

    // Media is end-to-end encrypted exactly when the room is, like Element Call does.
    const keyProvider = room.hasEncryptionStateEvent() ? new MatrixKeyProvider() : null
    const livekitRoom = new LivekitRoom({
      adaptiveStream: true,
      dynacast: true,
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

    await this.livekitRoom.connect(sfu.url, sfu.jwt)
    debug('connected to SFU')
    this.connectionState = 'connected'
    this.changed()

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

  private attachListeners(): void {
    const room = this.livekitRoom
    const changed = () => this.changed()

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
        this.connectionState = 'connected'
      }
      this.changed()
    }
    const onDisconnected = (reason?: DisconnectReason) => {
      if (this.isLeaving) return
      const message =
        reason === DisconnectReason.DUPLICATE_IDENTITY
          ? 'Du bist diesem Anruf auf einem anderen Gerät beigetreten.'
          : 'Die Verbindung zum Sprachkanal wurde getrennt.'
      void this.leave(message)
    }

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

    const onKey = (key: Uint8Array<ArrayBuffer>, index: number, _membership: unknown, rtcBackendIdentity: string) => {
      void this.keyProvider?.setMediaKey(key, index, rtcBackendIdentity).then((imported) => {
        if (imported && rtcBackendIdentity === this.ownIdentity) this.resolveOwnKey()
      })
    }
    const onManagerError = (error: unknown) => {
      console.error('MatrixRTC membership error:', error)
      void this.leave('Die Teilnahme am Anruf konnte nicht aufrechterhalten werden.')
    }
    this.rtcSession.on(MatrixRTCSessionEvent.EncryptionKeyChanged, onKey)
    this.rtcSession.on(MatrixRTCSessionEvent.MembershipsChanged, changed)
    this.rtcSession.on(MatrixRTCSessionEvent.MembershipManagerError, onManagerError)

    this.cleanups.push(() => {
      room.off(LivekitRoomEvent.TrackSubscribed, onTrackSubscribed)
      room.off(LivekitRoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
      room.off(LivekitRoomEvent.ConnectionStateChanged, onConnectionStateChanged)
      room.off(LivekitRoomEvent.Disconnected, onDisconnected)
      simpleEvents.forEach((event) => room.off(event, changed))
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
        videoFeeds.push({
          id: `${participant.identity}-${source}`,
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
    this.changed()
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (enabled) await this.waitForOwnKey()
    if (this.isLeaving) return
    await this.livekitRoom.localParticipant.setCameraEnabled(enabled)
    this.changed()
  }

  async setScreenShareEnabled(enabled: boolean): Promise<void> {
    if (enabled) await this.waitForOwnKey()
    if (this.isLeaving) return
    await this.livekitRoom.localParticipant.setScreenShareEnabled(enabled, { audio: true })
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

    this.cleanups.forEach((cleanup) => cleanup())
    this.cleanups.length = 0

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
