import type { Client } from '../../../types/youtube/Client'
import { DEFAULT_USER_AGENT } from '../../../utils/http'
import { parseYtMusicSearch } from '../searchParse'
import { MUSIC_SEARCH_URL } from '../shared'

export const WebRemixClient: Client = {
	client: {
		clientName: 'WEB_REMIX',
		clientVersion: '1.20261027.10.00',
		userAgent: DEFAULT_USER_AGENT,
		hl: 'en',
		gl: 'US',
		visitorData: undefined
	},
	user: { lockedSafetyMode: false },
	request: { useSsl: true },
	search
}

async function search(query: string) {
	const response = await fetch(MUSIC_SEARCH_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			context: {
				client: WebRemixClient.client,
				user: WebRemixClient.user,
				request: WebRemixClient.request
			},
			query,
			params: 'EgWKAQIIAWoOEAQQAxAJEAUQChAQEBU%3D'
		})
	})

	if (!response.ok) {
		throw new Error(`YouTube Music search failed with status ${response.status}: ${await response.text()}`)
	}

	const data = await response.json()
	return parseYtMusicSearch(data)
}
