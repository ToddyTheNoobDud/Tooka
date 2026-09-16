import type pino from 'pino'
import type { ConfigProps } from '../../types/config/configmanager.types'
import type { Track } from '../../utils'

export interface SourceContext {
  config: ConfigProps
  logger: pino.Logger
}

export interface Source {
  name: string
  enabled: boolean
  supportsSearch: boolean
  searchPrefix?: string
  load(context: SourceContext): Promise<void>
  loadTrack(identifier: string, context: SourceContext): Promise<LoadResult>
}

export type LoadResult =
  | { loadType: 'empty' }
  | { loadType: 'error'; message: string }
  | { loadType: 'track'; track: Track }
  | { loadType: 'search'; tracks: Track[] }
