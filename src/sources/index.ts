import type { Context } from '../shared/context'
import type { Source, StreamSource } from '../shared/sources'
import type { Track } from '../types/utils'
import { httpSource } from './http'
import { soundcloudSource } from './soundcloud'
import { YoutubeSource } from './youtube'

// Every source the node can load from. To add one: write the file, export the
// source object from it, then list it here.
export const sources: Source[] = [soundcloudSource, YoutubeSource, httpSource]

export async function loadSources(context: Context): Promise<void> {
	// Concurrent: source loads are independent, so a slow one never blocks
	// the rest at boot.
	await Promise.all(
		sources.map(async (source) => {
			try {
				await source.load(context)
			} catch (error) {
				source.enabled = false
				context.logger.error({ err: error, source: source.name }, 'Source failed to load, disabling it.')
			}
		})
	)
	const enabled = sources.filter((source) => source.enabled).length
	context.logger.info(`Loaded ${enabled}/${sources.length} source(s).`)
}

export function resolveSource(identifier: string): Source | undefined {
	const prefix = identifier.split(':')[0]
	for (const source of sources) {
		if (!source.enabled) {
			continue
		}
		if (source.searchPrefix && prefix === source.searchPrefix) {
			return source
		}
		if (source.canResolve?.(identifier)) {
			return source
		}
	}
	return undefined
}

export async function resolveSingleTrack(identifier: string, context: Context): Promise<Track | null> {
	const source = resolveSource(identifier)
	if (!source) {
		return null
	}
	const result = await source.loadTrack(identifier, context)
	return result.loadType === 'track' ? result.track : null
}

// Play-time stream lookup by the track's owning source. Stream URLs expire,
// so callers must invoke this per play, never cache the result.
export async function resolveTrackStream(track: Track, context: Context): Promise<StreamSource | null> {
	const uri = track.info.uri
	if (!uri) {
		return null
	}
	const source = sources.find((candidate) => candidate.enabled && candidate.name === track.info.sourceName)
	if (!source?.resolveStreamUrl) {
		context.logger.warn(`No stream resolver for source "${track.info.sourceName}".`)
		return null
	}
	return source.resolveStreamUrl(uri, context)
}
