/**
 * Tooka v4 player wire types (stored as-is, applied by the voice layer).
 */
import type { Track } from '../types/utils'

export interface VoiceState {
  token: string
  endpoint: string
  sessionId: string
  channelId: string | null
}

export interface EqualizerBand {
  band: number
  gain: number
}

export interface KaraokeFilter {
  level?: number
  monoLevel?: number
  filterBand?: number
  filterWidth?: number
}

export interface TimescaleFilter {
  speed?: number
  pitch?: number
  rate?: number
}

export interface TremoloFilter {
  frequency?: number
  depth?: number
}

export interface VibratoFilter {
  frequency?: number
  depth?: number
}

export interface RotationFilter {
  rotationHz?: number
}

export interface DistortionFilter {
  sinOffset?: number
  sinScale?: number
  cosOffset?: number
  cosScale?: number
  tanOffset?: number
  tanScale?: number
  offset?: number
  scale?: number
}

export interface ChannelMixFilter {
  leftToLeft?: number
  leftToRight?: number
  rightToLeft?: number
  rightToRight?: number
}

export interface LowPassFilter {
  smoothing?: number
}

export interface Filters {
  volume?: number
  equalizer?: EqualizerBand[]
  karaoke?: KaraokeFilter
  timescale?: TimescaleFilter
  tremolo?: TremoloFilter
  vibrato?: VibratoFilter
  rotation?: RotationFilter
  distortion?: DistortionFilter
  channelMix?: ChannelMixFilter
  lowPass?: LowPassFilter
  pluginFilters?: Record<string, unknown>
}

export interface PlayerState {
  time: number
  position: number
  connected: boolean
  ping: number
}

export interface SerializedPlayer {
  guildId: string
  track: Track | null
  volume: number
  paused: boolean
  state: PlayerState
  voice: VoiceState
  filters: Filters
}

export interface UpdatePlayerTrack {
  encoded?: string | null
  identifier?: string
  userData?: Record<string, unknown>
}

export interface UpdatePlayerBody {
  track?: UpdatePlayerTrack
  encodedTrack?: string | null
  identifier?: string
  position?: number
  endTime?: number | null
  volume?: number
  paused?: boolean
  filters?: Filters
  voice?: VoiceState
}
