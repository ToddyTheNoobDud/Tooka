/* DAVE/MLS session wrapper around @snazzah/davey. Owns group state and
  media crypto; the connection owns gateway signaling and UDP transport. */

import type { DAVESession, ProposalsOperationType } from '@snazzah/davey'
import type pino from 'pino'
import { isSilenceFrame, OPUS_SILENCE_FRAME } from './opus'

type DaveyModule = typeof import('@snazzah/davey')

let davey: DaveyModule | null = null

function getDavey(): DaveyModule {
  if (!davey) throw new Error('DAVE library used before ensureDavey().')
  return davey
}

// Loads the native MLS lib on first voice connect. daveEnabled=false
// connections never call this, so REST-only boots skip it entirely.
export async function ensureDavey(): Promise<number> {
  if (!davey) davey = await import('@snazzah/davey')
  return davey.DAVE_PROTOCOL_VERSION
}

export interface DaveCallbacks {
  sendKeyPackage(package_: Buffer): void
  sendCommitWelcome(payload: Buffer): void
  sendTransitionReady(transitionId: number): void
  sendInvalidCommitWelcome(transitionId: number): void
}

const FAILURE_TOLERANCE = 36
const PASSTHROUGH_WINDOW_SECS = 10

export class DaveSession implements Disposable {
  private session: DAVESession | null = null
  private readonly userId: string
  private readonly channelId: string
  private readonly logger: pino.Logger
  private readonly callbacks: DaveCallbacks
  private protocolVersion = 0
  private readonly pendingTransitions = new Map<number, number>()
  private downgraded = false
  private consecutiveFailures = 0
  private lastTransitionId = 0
  private readyNotified = false

  constructor(
    userId: string,
    channelId: string,
    logger: pino.Logger,
    callbacks: DaveCallbacks
  ) {
    this.userId = userId
    this.channelId = channelId
    this.logger = logger
    this.callbacks = callbacks
  }

  public get ready(): boolean {
    return this.protocolVersion !== 0 && (this.session?.ready ?? false)
  }

  // True when audio frames may be sent as-is: transport-only mode, or the
  // MLS group is established. Otherwise callers must send silence and hold
  // position - never plaintext audio, E2EE receivers drop it.
  public get sendReady(): boolean {
    return this.protocolVersion === 0 || (this.session?.ready ?? false)
  }

  public get version(): number {
    return this.protocolVersion
  }

  public init(protocolVersion: number): void {
    if (protocolVersion <= 0) {
      this.reset()
      return
    }
    if (this.session) {
      this.session.reinit(protocolVersion, this.userId, this.channelId)
    } else {
      this.session = new (getDavey().DAVESession)(
        protocolVersion,
        this.userId,
        this.channelId
      )
    }
    this.protocolVersion = protocolVersion
    this.readyNotified = false
    const session = this.session
    if (!session) throw new Error('DAVE session failed to initialize.')
    const keyPackage = session.getSerializedKeyPackage()
    this.logger.debug(
      `DAVE session init v${protocolVersion}, key package ${keyPackage.length} bytes.`
    )
    this.callbacks.sendKeyPackage(keyPackage)
  }

  public reset(): void {
    this.protocolVersion = 0
    this.pendingTransitions.clear()
    this.consecutiveFailures = 0
    try {
      this.session?.reset()
      this.session?.setPassthroughMode(true, PASSTHROUGH_WINDOW_SECS)
    } catch {
      // nothing to reset
    }
  }

  public destroy(): void {
    this.pendingTransitions.clear()
    try {
      this.session?.reset()
    } catch {
      // already gone
    }
    this.session = null
    this.protocolVersion = 0
  }

  public [Symbol.dispose](): void {
    this.destroy()
  }

  public setExternalSender(data: Uint8Array): void {
    try {
      this.session?.setExternalSender(Buffer.from(data))
      this.logger.debug('DAVE external sender set.')
    } catch (error) {
      this.logger.warn({ err: error }, 'DAVE external sender rejected.')
    }
  }

  public prepareTransition(transitionId: number, version: number): boolean {
    this.pendingTransitions.set(transitionId, version)
    if (transitionId === 0) {
      this.executeTransition(0)
      return false
    }
    if (version === 0) {
      try {
        this.session?.setPassthroughMode(true, PASSTHROUGH_WINDOW_SECS)
      } catch {
        // session not ready yet
      }
    }
    return true
  }

  public executeTransition(transitionId: number): void {
    const next = this.pendingTransitions.get(transitionId)
    if (next === undefined) return
    const old = this.protocolVersion
    this.protocolVersion = next
    if (old !== next && next === 0) {
      this.downgraded = true
    } else if (transitionId > 0 && this.downgraded && next > 0) {
      this.downgraded = false
      try {
        this.session?.setPassthroughMode(true, PASSTHROUGH_WINDOW_SECS)
      } catch {
        // session not ready yet
      }
    }
    this.pendingTransitions.delete(transitionId)
    this.consecutiveFailures = 0
    this.lastTransitionId = transitionId
    this.logger.debug(
      `DAVE transition ${transitionId} executed (v${old} -> v${next}).`
    )
  }

  public prepareEpoch(epoch: number, version: number): void {
    if (epoch !== 1) return
    this.protocolVersion = version
    this.downgraded = false
    this.init(version)
  }

  public onProposals(payload: Buffer, recognizedUserIds: string[]): void {
    const session = this.session
    if (!session) return
    const optype = payload.readUInt8(0) as ProposalsOperationType
    try {
      const { commit, welcome } = session.processProposals(
        optype,
        payload.subarray(1),
        recognizedUserIds
      )
      this.logger.debug(
        `DAVE proposals (op ${optype}): commit ${commit?.length ?? 0} bytes, welcome ${welcome?.length ?? 0} bytes.`
      )
      if (commit) {
        this.callbacks.sendCommitWelcome(
          welcome ? Buffer.concat([commit, welcome]) : commit
        )
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'DAVE proposals failed, reinitializing.')
      this.recover()
    }
  }

  public onCommit(payload: Buffer): void {
    const transitionId = payload.readUInt16BE(0)
    try {
      this.session?.processCommit(payload.subarray(2))
      if (transitionId !== 0) {
        this.pendingTransitions.set(transitionId, this.protocolVersion)
        this.callbacks.sendTransitionReady(transitionId)
      }
      this.consecutiveFailures = 0
      this.lastTransitionId = transitionId
      this.notifyReady()
    } catch (error) {
      this.logger.warn({ err: error }, 'DAVE commit failed, reinitializing.')
      this.recover()
    }
  }

  public onWelcome(payload: Buffer): void {
    const transitionId = payload.readUInt16BE(0)
    try {
      this.session?.processWelcome(payload.subarray(2))
      if (transitionId !== 0) {
        this.pendingTransitions.set(transitionId, this.protocolVersion)
        this.callbacks.sendTransitionReady(transitionId)
      }
      this.consecutiveFailures = 0
      this.lastTransitionId = transitionId
      this.notifyReady()
    } catch (error) {
      this.logger.warn({ err: error }, 'DAVE welcome failed, reinitializing.')
      this.recover()
    }
  }

  // Dispatches a binary gateway message to the DAVE session. Returns true
  // when the opcode was a known DAVE message (even if the session ignored
  // it); false for opcodes the transport layer should report as unknown.
  public onBinaryMessage(
    opcode: number,
    payload: Buffer,
    recognizedUserIds: string[]
  ): boolean {
    switch (opcode) {
      case 25:
        this.setExternalSender(payload)
        return true
      case 27:
        this.onProposals(payload, recognizedUserIds)
        return true
      case 29:
        this.onCommit(payload)
        return true
      case 30:
        this.onWelcome(payload)
        return true
      default:
        return false
    }
  }

  public encrypt(frame: Uint8Array): Uint8Array | null {
    if (isSilenceFrame(frame)) return frame
    if (this.protocolVersion === 0) return frame
    const session = this.session
    if (!session?.ready) return OPUS_SILENCE_FRAME
    try {
      const encrypted = session.encryptOpus(
        Buffer.isBuffer(frame) ? frame : Buffer.from(frame)
      )
      this.consecutiveFailures = 0
      return encrypted
    } catch (error) {
      this.consecutiveFailures += 1
      this.logger.warn({ err: error }, 'DAVE encrypt failed.')
      if (this.consecutiveFailures > FAILURE_TOLERANCE) {
        this.logger.warn('DAVE encrypt keeps failing, reinitializing.')
        this.recover()
      }
      return null
    }
  }

  private notifyReady(): void {
    if (this.readyNotified || !this.ready) return
    this.readyNotified = true
    this.logger.info(
      `DAVE session ready (epoch ${String(this.session?.epoch)}, privacy ${this.session?.voicePrivacyCode}).`
    )
  }

  private recover(): void {
    this.logger.warn('DAVE recovering: invalid commit, reinitializing session.')
    this.callbacks.sendInvalidCommitWelcome(this.lastTransitionId)
    this.consecutiveFailures = 0
    this.init(this.protocolVersion)
  }
}
