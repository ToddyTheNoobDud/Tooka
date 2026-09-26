import type pino from 'pino'
import type { ConfigProps } from '../types/config'
import type { Track } from '../types/utils'

export interface SourceContext {
  config: ConfigProps
  logger: pino.Logger
}

export interface StreamSource {
  url: string
  authorization: string | null
}

export interface Source {
  name: string
  enabled: boolean
  supportsSearch: boolean
  searchPrefix?: string
  load(context: SourceContext): Promise<void>
  loadTrack(identifier: string, context: SourceContext): Promise<LoadResult>
  canResolve?: (identifier: string) => boolean
  // Play-time stream resolution. Transcode URLs expire, so this runs per
  // play, never cached. Sources without playable audio omit it.
  resolveStreamUrl?: (
    pageUrl: string,
    context: SourceContext
  ) => Promise<StreamSource | null>
  // Generic catch-alls (http) set this so specific sources win regardless
  // of discovery order.
  fallback?: boolean
}

export interface PlaylistInfo {
  name: string
  selectedTrack: number
}

export type LoadResult =
  | { loadType: 'empty' }
  | { loadType: 'error'; message: string }
  | { loadType: 'track'; track: Track }
  | { loadType: 'search'; tracks: Track[] }
  | { loadType: 'playlist'; info: PlaylistInfo; tracks: Track[] }
