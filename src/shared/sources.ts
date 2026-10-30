import type { Track } from '../types/utils'
import type { Context } from './context'

export interface StreamSource {
	url: string
	authorization: string | null
}

export interface Source {
	name: string
	enabled: boolean
	searchPrefix?: string
	load(context: Context): Promise<void>
	loadTrack(identifier: string, context: Context): Promise<LoadResult>
	canResolve?: (identifier: string) => boolean
	// Play-time stream resolution. Transcode URLs expire, so this runs per
	// play, never cached. Sources without playable audio omit it.
	resolveStreamUrl?: (pageUrl: string, context: Context) => Promise<StreamSource | null>
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
