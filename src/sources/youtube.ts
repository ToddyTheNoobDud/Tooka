import type { Context } from '../shared/context'
import type { LoadResult, Source } from '../shared/sources'
import type { Client } from '../types/youtube/Client'

import { AndroidClient } from './youtubeHandlers/clients/Android'
import { WebRemixClient } from './youtubeHandlers/clients/Web_remix'

const clientsToImport = [AndroidClient, WebRemixClient]

const clients = new Map<string, Client>()

function loadClients(context: Context) {
	const youtubeConfig = context.config.sources.youtube
	// const youtubeMusicConfig = context.config.sources.youtubemusic
	const configuredNames = [
		...youtubeConfig.searchingClients,
		...youtubeConfig.resolvingClients,
		...youtubeConfig.playbackClients
		// ...youtubeMusicConfig.searchingClients
	]

	for (const client of clientsToImport) {
		const { clientName } = client.client

		if (configuredNames.includes(clientName)) {
			clients.set(clientName, client)
		}
	}
}
export const YoutubeSource: Source = {
	name: 'youtube',
	enabled: true,
	searchPrefix: 'ytsearch',
	canResolve: (identifier) => identifier.startsWith('ytmsearch:'),
	load: async (context) => {
		loadClients(context)
		context.logger.info(`Youtube source loaded with ${clients.size} clients`)
	},
	loadTrack: async (identifier, context) => {
		if (identifier.startsWith('ytsearch:') || identifier.startsWith('ytmsearch:')) {
			return search(identifier, context)
		}

		return { loadType: 'empty' }
	}
}

async function search(identifier: string, context: Context): Promise<LoadResult> {
	const query = identifier.slice(identifier.indexOf(':') + 1).trim()
	if (!query) {
		return { loadType: 'empty' }
	}

	const sourceConfig = identifier.startsWith('ytmsearch:')
		? context.config.sources.youtubemusic
		: context.config.sources.youtube

	for (const clientName of sourceConfig.searchingClients) {
		const client = clients.get(clientName)
		if (!client?.search) {
			continue
		}

		try {
			const tracks = await client.search(query)

			return tracks.length > 0 ? { loadType: 'search', tracks } : { loadType: 'empty' }
		} catch (error) {
			context.logger.warn({ err: error, client: clientName }, 'YouTube search failed.')
			return { loadType: 'error', message: 'YouTube search failed' }
		}
	}

	return { loadType: 'error', message: 'No configured YouTube client supports search' }
}
