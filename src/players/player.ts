import type { Filters, SerializedPlayer, VoiceState } from '../shared/players'
import type { Track } from '../types/utils'
import type { VoiceConnection } from '../voice/connection'
import type { FrameQueue } from '../voice/queue'
import { playerStateSnapshot } from './sessions'

export interface Playback extends Disposable {
  key: string
  queue: FrameQueue
  stop: () => void
}

export class Player implements Disposable {
  readonly guildId: string
  track: Track | null = null
  volume = 100
  paused = false
  voice: VoiceState = {
    token: '',
    endpoint: '',
    sessionId: '',
    channelId: null
  }
  filters: Filters = {}
  position = 0
  endTime: number | null = null
  connection: VoiceConnection | null = null
  playback: Playback | null = null
  lastAudioAt = 0
  stuckNotified = false

  constructor(guildId: string) {
    this.guildId = guildId
  }

  public setTrack(track: Track | null): void {
    this.track = track ? { ...track, info: { ...track.info } } : null
    this.setPosition(track?.info.position ?? 0)
  }

  public setPosition(position: number): void {
    this.position = position
    if (this.track) this.track.info.position = position
  }

  public serialize(): SerializedPlayer {
    return {
      guildId: this.guildId,
      track: this.track,
      volume: this.volume,
      paused: this.paused,
      state: playerStateSnapshot(this),
      voice: this.voice,
      filters: this.filters
    }
  }

  public destroy(): void {
    try {
      this.playback?.stop()
    } catch {
      // already stopped
    }
    this.playback = null
    try {
      this.connection?.destroy()
    } catch {
      // already gone
    }
    this.connection = null
  }

  public [Symbol.dispose](): void {
    this.destroy()
  }
}
