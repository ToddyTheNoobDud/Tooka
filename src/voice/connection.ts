/* Discord voice connection: gateway handshake, DAVE/MLS, UDP transport.
  Sends real audio frames from an attached FrameQueue, silence otherwise.
*/

import type pino from 'pino'
import {
  type EncryptionPreference,
  ensureSodium,
  lockKey,
  negotiateMode,
  RTP_HEADER_SIZE,
  sealAesGcm,
  sealedSize,
  sealXchacha,
  type TransportMode,
  unlockKey,
  writeRtpHeader
} from './crypto'
import { DaveSession, ensureDavey } from './dave'
import { waitForGatewayOp } from './gateway'
import {
  isSilenceFrame,
  OPUS_FRAME_DURATION_MS,
  OPUS_SILENCE_FRAME
} from './opus'
import {
  buildDiscoveryPacket,
  GATEWAY_VERSION,
  IDLE_SILENCE_FRAMES,
  MAX_NONCE,
  PENDING_QUEUE_MAX,
  parseDiscoveryResponse,
  splitHostPort,
  toBytes
} from './protocol'
import type { FrameQueue } from './queue'
import { voiceScheduler } from './scheduler'

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'destroyed'

export interface VoiceConnectionOptions {
  endpoint: string
  serverId: string
  channelId: string
  userId: string
  sessionId: string
  token: string
  logger: pino.Logger
  handshakeTimeoutMs: number
  discoveryTimeoutMs: number
  keepAliveIntervalMs: number
  encryption: EncryptionPreference
  daveMaxVersion: number
  onAudioFrame?: (frame: Uint8Array) => void
  onGatewayClose?: (code: number, reason: string, byRemote: boolean) => void
}

type UdpSocket = Bun.udp.ConnectedSocket<'buffer'>

export class VoiceConnection implements Disposable {
  public state: ConnectionState = 'connecting'

  private readonly options: VoiceConnectionOptions
  private readonly logger: pino.Logger
  private ws: WebSocket | null = null
  private udp: UdpSocket | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private missedAcks = 0

  private ssrc = 0
  private secretKey: Buffer | null = null
  private mode: TransportMode = 'aead_aes256_gcm_rtpsize'
  private credentials: { token: string; endpoint: string; sessionId: string }
  private sequence = 0
  private timestamp = 0
  private nonce = 0
  private nextDue = 0
  private speaking = false
  private scheduled = false
  private idleSilences = IDLE_SILENCE_FRAMES
  private readonly pending: Buffer[] = []
  private readonly sendBuffer = Buffer.alloc(1500)
  private packetsSent = 0
  private packetsDropped = 0
  private framesDropped = 0
  private expectedFrames = 0
  private established = false
  private localClose = false
  private ping = -1
  private lastSequence = -1
  private udpData: ((data: Buffer) => void) | null = null
  private handshakeReject: ((error: Error) => void) | null = null
  private frames: FrameQueue | null = null
  private readonly dave: DaveSession
  private readonly connectedUserIds = new Set<string>()
  private keepAlive: ReturnType<typeof setInterval> | null = null
  private keepAliveCounter = 0
  private readonly keepAliveBuffer = Buffer.alloc(8)

  private constructor(options: VoiceConnectionOptions) {
    this.options = options
    this.logger = options.logger
    this.credentials = {
      token: options.token,
      endpoint: options.endpoint,
      sessionId: options.sessionId
    }
    this.dave = new DaveSession(
      options.userId,
      options.channelId,
      options.logger,
      {
        sendKeyPackage: (package_) => this.sendBinary(26, package_),
        sendCommitWelcome: (payload) => this.sendBinary(28, payload),
        sendTransitionReady: (transitionId) =>
          this.sendGateway(23, { transition_id: transitionId }),
        sendInvalidCommitWelcome: (transitionId) =>
          this.sendGateway(31, { transition_id: transitionId })
      }
    )
  }

  public attachFrames(frames: FrameQueue | null): void {
    this.frames = frames
    if (!frames) return
    // Fresh audio to send: reset the stop-silence budget and make sure the
    // ticker runs (a previous idle may have unregistered it).
    this.idleSilences = IDLE_SILENCE_FRAMES
    if (this.state === 'connected' && !this.scheduled) {
      this.nextDue = performance.now()
      voiceScheduler.register(this, this, this.nextDue)
      this.scheduled = true
    }
    this.setSpeaking(true)
  }

  public matches(credentials: {
    token: string
    endpoint: string
    sessionId: string
  }): boolean {
    return (
      this.credentials.token === credentials.token &&
      this.credentials.endpoint === credentials.endpoint &&
      this.credentials.sessionId === credentials.sessionId
    )
  }

  public static async connect(
    options: VoiceConnectionOptions
  ): Promise<VoiceConnection> {
    const connection = new VoiceConnection(options)
    const log = connection.logger
    if (options.daveMaxVersion > 0) await ensureDavey()
    log.debug(
      `Voice identify creds (guild ${options.serverId}): endpoint ${options.endpoint}, user ${options.userId}, session ${options.sessionId.slice(0, 8)}…, token ${options.token.length} chars starting ${options.token.slice(0, 8)}.`
    )
    using rollback = new DisposableStack()
    rollback.use(connection)

    const { host, port } = splitHostPort(options.endpoint)
    log.debug(
      `Voice gateway opening wss://${host}:${port} (guild ${options.serverId}).`
    )
    await connection.openGateway(host, port)
    const ready = await connection.waitForReady()
    log.debug(
      `Voice gateway ready (ssrc ${ready.ssrc}, ${ready.ip}:${ready.port}, modes ${ready.modes.join(',')}).`
    )
    connection.ssrc = ready.ssrc
    connection.mode = negotiateMode(ready.modes, options.encryption)
    log.debug(`Transport mode negotiated: ${connection.mode}.`)
    if (connection.mode === 'aead_xchacha20_poly1305_rtpsize') {
      await ensureSodium()
    }
    await connection.openUdp(ready.ip, ready.port)
    const discovered = await connection.discoverIp()
    await connection.selectProtocol(discovered.address, discovered.port)
    log.debug(`Select protocol sent (${connection.mode}).`)
    await connection.waitForSessionDescription()
    connection.sequence = Math.floor(Math.random() * 65536)
    connection.timestamp = Math.floor(Math.random() * 4294967296)
    connection.nonce = 0
    connection.state = 'connected'
    connection.established = true
    connection.setSpeaking(true)
    connection.nextDue = performance.now()
    voiceScheduler.register(connection, connection, connection.nextDue)
    connection.scheduled = true
    connection.keepAlive = setInterval(
      () => connection.sendKeepAlive(),
      options.keepAliveIntervalMs
    )
    connection.keepAlive.unref?.()
    connection.logger.info(
      `Voice connected in guild ${options.serverId} (ssrc ${connection.ssrc}).`
    )
    rollback.move()
    return connection
  }

  public tick(now: number): number | null {
    if (this.state !== 'connected' || !this.secretKey || !this.udp) {
      this.scheduled = false
      return null
    }
    if (now - this.nextDue > 100) this.nextDue = now
    // Every scheduled tick owes the receiver one frame. sent/nulled/deficit
    // in the stats op derive from expectedFrames vs packetsSent.
    this.expectedFrames += 1
    // E2EE expected but the MLS group isn't established (e.g. sole-member
    // reset while alone): hold the song, keep the stream alive with silence.
    // Position only advances for frames actually heard.
    if (!this.dave.sendReady) {
      this.sendFrame(OPUS_SILENCE_FRAME)
      this.nextDue += OPUS_FRAME_DURATION_MS
      return this.nextDue
    }
    // Idle (no track, paused, stopped): five silence frames per the Discord
    // docs, then radio silence. NAT stays open via the UDP keepalive.
    // can be found here (if u are seeing this): https://docs.discord.com/developers/topics/voice-connections#voice-data-interpolation
    if (!this.frames) {
      if (this.idleSilences <= 0) {
        this.setSpeaking(false)
        this.scheduled = false
        return null
      }
      this.idleSilences -= 1
      this.sendFrame(OPUS_SILENCE_FRAME)
      this.nextDue += OPUS_FRAME_DURATION_MS
      return this.nextDue
    }
    const queued = this.frames?.shift() ?? null
    let frame: Uint8Array = OPUS_SILENCE_FRAME
    if (queued) {
      frame = queued
      this.options.onAudioFrame?.(queued)
    }
    if (!isSilenceFrame(frame)) {
      const encrypted = this.dave.encrypt(frame)
      if (!encrypted) {
        this.framesDropped += 1
        this.nextDue += OPUS_FRAME_DURATION_MS
        return this.nextDue
      }
      frame = encrypted
    }
    this.sendFrame(frame)
    this.nextDue += OPUS_FRAME_DURATION_MS
    return this.nextDue
  }

  public destroy(): void {
    if (this.state === 'destroyed') return
    if (this.state === 'connected') {
      try {
        this.setSpeaking(false)
      } catch {
        // socket already gone
      }
    }
    this.state = 'destroyed'
    voiceScheduler.unregister(this)
    this.scheduled = false
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    if (this.keepAlive) clearInterval(this.keepAlive)
    this.keepAlive = null
    this.pending.length = 0
    this.dave[Symbol.dispose]()
    try {
      this.udp?.close()
    } catch {
      // already closed
    }
    this.udp = null
    this.localClose = true
    try {
      this.ws?.close()
    } catch {
      // already closed
    }
    this.ws = null
    if (this.secretKey) unlockKey(this.secretKey)
    this.secretKey = null
    this.logger.info(
      `Voice connection destroyed for guild ${this.options.serverId}.`
    )
  }

  public [Symbol.dispose](): void {
    this.destroy()
  }

  public stats(): {
    state: ConnectionState
    packetsSent: number
    packetsDropped: number
    framesDropped: number
    expectedFrames: number
    ping: number
    daveReady: boolean
  } {
    return {
      state: this.state,
      packetsSent: this.packetsSent,
      packetsDropped: this.packetsDropped,
      framesDropped: this.framesDropped,
      expectedFrames: this.expectedFrames,
      ping: this.ping,
      daveReady: this.dave.ready
    }
  }

  private sendFrame(frame: Uint8Array): void {
    const udp = this.udp
    const key = this.secretKey
    if (!udp || !key) return
    if (this.nonce >= MAX_NONCE) {
      this.logger.warn('Nonce exhausted, destroying voice connection.')
      this.destroy()
      return
    }
    const packet = this.sendBuffer.subarray(0, sealedSize(frame.length))
    writeRtpHeader(packet, this.sequence, this.timestamp >>> 0, this.ssrc)
    const seal =
      this.mode === 'aead_xchacha20_poly1305_rtpsize' ? sealXchacha : sealAesGcm
    seal(packet, key, this.nonce, packet.subarray(0, RTP_HEADER_SIZE), frame)
    this.sequence = (this.sequence + 1) & 0xffff
    this.timestamp = (this.timestamp + 960) >>> 0
    this.nonce += 1
    if (udp.send(packet) === false) {
      if (this.pending.length >= PENDING_QUEUE_MAX) {
        this.pending.shift()
        this.packetsDropped += 1
      }
      this.pending.push(Buffer.from(packet))
    } else {
      this.packetsSent += 1
    }
  }

  private flushPending(): void {
    const udp = this.udp
    if (!udp) {
      this.pending.length = 0
      return
    }
    while (this.pending.length > 0) {
      const packet = this.pending[0] as Buffer
      if (udp.send(packet) === false) return
      this.pending.shift()
      this.packetsSent += 1
    }
  }

  private setSpeaking(speaking: boolean): void {
    if (this.speaking === speaking) return
    this.speaking = speaking
    this.sendGateway(5, {
      speaking: speaking ? 1 : 0,
      delay: 0,
      ssrc: this.ssrc
    })
  }

  private sendGateway(op: number, data: unknown): void {
    try {
      this.ws?.send(JSON.stringify({ op, d: data }))
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to send voice gateway payload.')
    }
  }

  private sendBinary(opcode: number, payload: Uint8Array): void {
    const ws = this.ws
    if (!ws) return
    const frame = Buffer.allocUnsafe(1 + payload.length)
    frame[0] = opcode
    Buffer.from(payload).copy(frame, 1)
    try {
      ws.send(frame)
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to send voice gateway binary.')
    }
  }

  private sendKeepAlive(): void {
    if (!this.udp) return
    this.keepAliveBuffer.writeUInt32LE(this.keepAliveCounter >>> 0, 0)
    this.keepAliveCounter = (this.keepAliveCounter + 1) >>> 0
    this.udp.send(this.keepAliveBuffer)
  }

  private openGateway(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://${host}:${port}/?v=${GATEWAY_VERSION}`)
      const timeout = setTimeout(() => {
        reject(new Error('Voice gateway hello timed out.'))
      }, this.options.handshakeTimeoutMs)
      timeout.unref?.()
      ws.onopen = () => {
        this.sendGateway(0, {
          server_id: this.options.serverId,
          user_id: this.options.userId,
          session_id: this.options.sessionId,
          token: this.options.token,
          max_dave_protocol_version: this.options.daveMaxVersion
        })
      }
      ws.onmessage = (event) => {
        void this.onGatewayMessage(event.data).then((hello) => {
          if (hello) {
            clearTimeout(timeout)
            resolve()
          }
        })
      }
      ws.onerror = (event) => {
        clearTimeout(timeout)
        const detail =
          event instanceof ErrorEvent ? event.message : 'unknown error'
        reject(new Error(`Voice gateway connection failed: ${detail}`))
      }
      ws.onclose = (event) => {
        clearTimeout(timeout)
        const code = event instanceof CloseEvent ? event.code : 'unknown'
        const reason =
          event instanceof CloseEvent ? event.reason : 'unknown close'
        if (this.state !== 'destroyed') {
          this.logger.warn(`Voice gateway closed (code ${code}).`)
        }
        this.handshakeReject?.(
          new Error(`Voice gateway closed (code ${code}).`)
        )
        this.handshakeReject = null
        const wasLive = this.established
        const byRemote = !this.localClose
        this.destroy()
        // Only established players get the event: handshake failures never
        // played audio, and numeric codes are all the protocol accepts.
        if (wasLive && typeof code === 'number') {
          try {
            this.options.onGatewayClose?.(code, reason, byRemote)
          } catch {
            // client notification must not break teardown
          }
        }
        reject(
          new Error(`Voice gateway closed during handshake (code ${code}).`)
        )
      }
      this.ws = ws
    })
  }

  private async onGatewayMessage(data: unknown): Promise<boolean> {
    if (typeof data === 'string') {
      const payload = JSON.parse(data) as {
        op: number
        d?: unknown
        seq?: number
      }
      if (typeof payload.seq === 'number') this.lastSequence = payload.seq
      switch (payload.op) {
        case 8: {
          const interval = (payload.d as { heartbeat_interval: number })
            .heartbeat_interval
          this.logger.debug(`Voice gateway hello (heartbeat ${interval}ms).`)
          this.startHeartbeat(interval)
          return true
        }
        case 6: {
          this.missedAcks = 0
          const at = (payload.d as { t?: number }).t
          if (typeof at === 'number') this.ping = Date.now() - at
          return false
        }
        case 11: {
          const ids = (payload.d as { user_ids?: unknown }).user_ids
          if (Array.isArray(ids)) {
            for (const id of ids) {
              if (typeof id === 'string' && id !== this.options.userId) {
                this.connectedUserIds.add(id)
              }
            }
          }
          return false
        }
        case 13: {
          const id = (payload.d as { user_id?: unknown }).user_id
          if (typeof id === 'string') this.connectedUserIds.delete(id)
          return false
        }
        case 21: {
          const transition = payload.d as {
            transition_id: number
            protocol_version: number
          }
          if (
            this.dave.prepareTransition(
              transition.transition_id,
              transition.protocol_version
            )
          ) {
            this.sendGateway(23, { transition_id: transition.transition_id })
          }
          return false
        }
        case 22: {
          const transition = payload.d as { transition_id: number }
          this.dave.executeTransition(transition.transition_id)
          return false
        }
        case 24: {
          const epoch = payload.d as {
            epoch: number
            protocol_version: number
          }
          this.dave.prepareEpoch(epoch.epoch, epoch.protocol_version)
          return false
        }
        default:
          return false
      }
    }
    const bytes = await toBytes(data)
    if (!bytes || bytes.length < 3) return false
    this.lastSequence = (bytes[0] as number) * 256 + (bytes[1] as number)
    const opcode = bytes[2] as number
    const payload = Buffer.from(bytes.subarray(3))
    if (
      !this.dave.onBinaryMessage(opcode, payload, [...this.connectedUserIds])
    ) {
      this.logger.debug(`Voice gateway unknown binary opcode ${opcode}.`)
    }
    return false
  }

  private startHeartbeat(interval: number): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = setInterval(() => {
      if (this.state === 'destroyed') return
      this.missedAcks += 1
      if (this.missedAcks > 2) {
        this.logger.warn('Voice gateway heartbeat missed, destroying.')
        this.destroy()
        return
      }
      this.sendGateway(3, { t: Date.now(), seq_ack: this.lastSequence })
    }, interval)
    this.heartbeat.unref?.()
  }

  private waitForReady(): Promise<{
    ssrc: number
    ip: string
    port: number
    modes: string[]
  }> {
    const ws = this.ws
    if (!ws) return Promise.reject(new Error('Voice gateway is not open.'))
    const wait = waitForGatewayOp(
      ws,
      2,
      this.options.handshakeTimeoutMs,
      'Voice gateway ready timed out.',
      (data) =>
        data as {
          ssrc: number
          ip: string
          port: number
          modes: string[]
        },
      (payload) => {
        if (payload.op === 6) this.missedAcks = 0
      }
    )
    this.handshakeReject = wait.reject
    return wait.promise
  }

  private async openUdp(address: string, port: number): Promise<void> {
    this.udp = await Bun.udpSocket({
      connect: { hostname: address, port },
      socket: {
        data: (_socket, data) => this.udpData?.(data),
        drain: () => this.flushPending(),
        error: (error) => {
          this.logger.warn({ err: error }, 'UDP socket error.')
        }
      }
    })
    this.udp.unref()
  }

  private discoverIp(): Promise<{ address: string; port: number }> {
    return new Promise((resolve, reject) => {
      const udp = this.udp
      if (!udp) {
        reject(new Error('UDP socket is not open.'))
        return
      }
      const request = buildDiscoveryPacket(this.ssrc)
      const timeout = setTimeout(() => {
        this.udpData = null
        reject(new Error('UDP IP discovery timed out.'))
      }, this.options.discoveryTimeoutMs)
      timeout.unref?.()
      this.handshakeReject = reject
      this.udpData = (response) => {
        const parsed = parseDiscoveryResponse(response)
        if (!parsed) return
        clearTimeout(timeout)
        this.udpData = null
        resolve(parsed)
      }
      if (udp.send(request) === false) {
        clearTimeout(timeout)
        this.udpData = null
        reject(new Error('UDP discovery packet was not sent.'))
      }
    })
  }

  private selectProtocol(address: string, port: number): Promise<void> {
    this.sendGateway(1, {
      protocol: 'udp',
      data: { address, port, mode: this.mode }
    })
    return Promise.resolve()
  }

  private waitForSessionDescription(): Promise<void> {
    const ws = this.ws
    if (!ws) return Promise.reject(new Error('Voice gateway is not open.'))
    const wait = waitForGatewayOp(
      ws,
      4,
      this.options.handshakeTimeoutMs,
      'Voice session description timed out.',
      (data) => {
        const description = data as {
          mode: string
          secret_key: number[]
          dave_protocol_version?: number
        }
        this.mode = negotiateMode([description.mode], this.options.encryption)
        this.secretKey = Buffer.from(description.secret_key)
        lockKey(this.secretKey)
        const daveVersion = Math.min(
          description.dave_protocol_version ?? 0,
          this.options.daveMaxVersion
        )
        this.logger.debug(
          `Session description: mode ${this.mode}, key ${this.secretKey.length} bytes, dave v${daveVersion}.`
        )
        this.dave.init(daveVersion)
      },
      (payload) => {
        if (payload.op === 6) this.missedAcks = 0
      }
    )
    this.handshakeReject = wait.reject
    return wait.promise
  }
}
