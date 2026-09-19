export interface EncodeTrackInput {
  identifier: string
  author: string
  length: number
  isStream: boolean
  title: string
  uri?: string | null
  artworkUrl?: string | null
  isrc?: string | null
  sourceName: string
  position?: number
}

export interface TrackInfo {
  identifier: string
  author: string
  length: number
  isStream: boolean
  title: string
  uri: string | null
  artworkUrl: string | null
  isrc: string | null
  sourceName: string
  position: number
  isSeekable: boolean
}

export interface Track {
  encoded: string
  info: TrackInfo
  pluginInfo: Record<string, unknown>
  userData: Record<string, unknown>
}

export interface PreparedString {
  standard: boolean
  byteLength: number
  bytes?: number[]
}
