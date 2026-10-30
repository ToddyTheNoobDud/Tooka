import type { Client } from '../../../types/youtube/Client'
import { parseYtSearch } from '../searchParse'
import { SEARCH_URL } from '../shared'

export const AndroidClient: Client = {
	client: {
		clientName: 'ANDROID',
		clientVersion: '21.43.523',
		userAgent: 'com.google.android.youtube (Linux; U; Android 16) gzip',
		androidVersion: '16',
		androidSdkVersion: 36,
		deviceMake: 'Google',
		deviceModel: 'Pixel 9 Pro',
		osName: 'Android',
		hl: 'en',
		gl: 'US',
		visitorData: undefined
	},
	user: { lockedSafetyMode: false },
	request: { useSsl: true },
	search
}

async function search(query: string) {
	const response = await fetch(SEARCH_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'User-Agent': AndroidClient.client.userAgent
		},
		body: JSON.stringify({
			context: {
				client: AndroidClient.client,
				user: AndroidClient.user,
				request: AndroidClient.request
			},
			query,
			params: 'oAIBEgIQAQ%3D%3D'
		})
	})

	if (!response.ok) {
		throw new Error(`YouTube Android search failed with status ${response.status}: ${await response.text()}`)
	}

	return parseYtSearch(await response.json())
}
