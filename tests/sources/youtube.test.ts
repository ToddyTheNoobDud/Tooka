import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import pino from 'pino'
import { loadTracksEndpoint } from '../../src/endpoints/loadtracks'
import type { Context } from '../../src/shared/context'
import { YoutubeSource } from '../../src/sources/youtube'
import { parseYtMusicSearch, parseYtSearch } from '../../src/sources/youtubeHandlers/searchParse'
import { decodeTrack } from '../../src/tracks/decoding'
import type { ConfigProps } from '../../src/types/config'
import type { Track } from '../../src/types/utils'

afterEach(() => {
	mock.restore()
})

const responseData = {
	contents: {
		tabbedSearchResultsRenderer: {
			tabs: [{
				tabRenderer: {
					selected: true,
					content: {
						sectionListRenderer: {
							contents: [
								{ musicCardShelfRenderer: {} },
								{
									musicShelfRenderer: {
										contents: [
											{ continuationItemRenderer: {} },
											{
												musicResponsiveListItemRenderer: {
													playlistItemData: { videoId: 'ZPhnyf_5bbk' },
													flexColumns: [
														{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'i got taste' }] } } },
														{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'slayr' }] } } }
													],
													fixedColumns: [
														{ musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '3:21' }] } } }
													]
												}
											}
										]
									}
								}
							]
						}
					}
				}
			}]
		}
	}
}

const androidResponseData = {
	contents: {
		sectionListRenderer: {
			contents: [
				{ continuationItemRenderer: {} },
				{ itemSectionRenderer: { contents: [
					{ channelRenderer: { channelId: 'channel' } },
					{ compactVideoRenderer: {
						videoId: 'ZPhnyf_5bbk',
						title: { runs: [{ text: 'i got ' }, { text: 'taste' }] },
						longBylineText: { runs: [{ text: 'slayr' }] },
						lengthText: { simpleText: '3:21' },
						thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/ZPhnyf_5bbk/hqdefault.jpg' }] }
					} },
					{ compactVideoRenderer: {
						videoId: 'long-video', title: { simpleText: 'Long video' },
						shortBylineText: { runs: [{ text: 'Another artist' }] },
						lengthText: { runs: [{ text: '1:02:03' }] }
					} },
					{ compactVideoRenderer: { videoId: 'live', title: { simpleText: 'Live' } } },
					{ compactVideoRenderer: {
						videoId: 'unavailable', title: { simpleText: 'Unavailable' },
						lengthText: { simpleText: '1:00' }, unplayableText: { simpleText: 'Blocked' }
					} }
				] } }
			]
		}
	}
}

async function makeContext(): Promise<Context> {
	const config = Bun.TOML.parse(await Bun.file('config.default.toml').text()) as unknown as ConfigProps
	config.sources.youtube.searchingClients = ['ANDROID']
	config.sources.youtubemusic.searchingClients = ['WEB_REMIX']
	const context = { config, logger: pino({ level: 'silent' }) }
	await YoutubeSource.load(context)
	return context
}

test('parses songs into encoded Tooka tracks and skips other renderers', () => {
	const tracks = parseYtMusicSearch(responseData)
	expect(tracks).toHaveLength(1)
	expect(tracks[0]!.info).toMatchObject({
		identifier: 'ZPhnyf_5bbk', title: 'i got taste', author: 'slayr', length: 201000,
		uri: 'https://music.youtube.com/watch?v=ZPhnyf_5bbk', sourceName: 'youtube'
	})
	expect(decodeTrack(tracks[0]!.encoded).info).toEqual(tracks[0]!.info)
	expect(parseYtMusicSearch({})).toEqual([])
})

test('returns music results through the endpoint using the requested query', async () => {
	const context = await makeContext()
	spyOn(globalThis, 'fetch').mockImplementation((async (input, options) => {
		expect(String(input)).toContain('music.youtube.com/youtubei/v1/search')
		const body = JSON.parse(options!.body as string)
		expect(body.query).toBe('slayr i got taste')
		expect(body.context.client.clientName).toBe('WEB_REMIX')
		return Response.json(responseData)
	}) as typeof fetch)
	const response = await loadTracksEndpoint.handle(
		new Request('http://localhost/v4/loadtracks?identifier=ytmsearch%3Aslayr%20i%20got%20taste'), context
	)
	const body = await response.json() as { loadType: string; data: Track[] }
	expect(body.loadType).toBe('search')
	expect(body.data).toHaveLength(1)
	expect(body.data[0]!.info.identifier).toBe('ZPhnyf_5bbk')
})

test('normal searches use Android and return encoded tracks through the endpoint', async () => {
	const context = await makeContext()
	spyOn(globalThis, 'fetch').mockImplementation((async (input, options) => {
		expect(String(input)).toBe('https://www.youtube.com/youtubei/v1/search?prettyPrint=false')
		expect(options!.method).toBe('POST')
		expect(new Headers(options!.headers).get('User-Agent')).toContain('com.google.android.youtube')
		const body = JSON.parse(options!.body as string)
		expect(body.query).toBe('slayr i got taste')
		expect(body.context.client.clientName).toBe('ANDROID')
		expect(body.context.client.androidSdkVersion).toBe(36)
		return Response.json(androidResponseData)
	}) as typeof fetch)
	const response = await loadTracksEndpoint.handle(
		new Request('http://localhost/v4/loadtracks?identifier=ytsearch%3Aslayr%20i%20got%20taste'), context
	)
	const body = await response.json() as { loadType: string; data: Track[] }
	expect(body.loadType).toBe('search')
	expect(body.data).toHaveLength(2)
	expect(body.data[0]!.info).toMatchObject({
		identifier: 'ZPhnyf_5bbk', title: 'i got taste', author: 'slayr', length: 201000,
		uri: 'https://www.youtube.com/watch?v=ZPhnyf_5bbk', sourceName: 'youtube',
		artworkUrl: 'https://i.ytimg.com/vi/ZPhnyf_5bbk/hqdefault.jpg'
	})
	expect(body.data[1]!.info).toMatchObject({ title: 'Long video', author: 'Another artist', length: 3723000 })
	for (const track of body.data) {
		expect(decodeTrack(track.encoded).info).toEqual(track.info)
	}
})

test('normal searches do not use music clients when none is configured', async () => {
	const context = await makeContext()
	context.config.sources.youtube.searchingClients = []
	const result = await YoutubeSource.loadTrack('ytsearch:slayr', context)
	expect(result).toEqual({ loadType: 'error', message: 'No configured YouTube client supports search' })
})

test('Android returns empty for responses without videos', async () => {
	expect(parseYtSearch({})).toEqual([])
	const context = await makeContext()
	spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ contents: { sectionListRenderer: { contents: [] } } }))
	expect(await YoutubeSource.loadTrack('ytsearch:no results', context)).toEqual({ loadType: 'empty' })
})

test('Android HTTP failures become source errors', async () => {
	const context = await makeContext()
	spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad Request', { status: 400 }))
	expect(await YoutubeSource.loadTrack('ytsearch:slayr', context)).toEqual({
		loadType: 'error', message: 'YouTube search failed'
	})
})

test('returns empty for a blank query or a response without songs', async () => {
	const context = await makeContext()
	expect(await YoutubeSource.loadTrack('ytmsearch: ', context)).toEqual({ loadType: 'empty' })
	spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}))
	expect(await YoutubeSource.loadTrack('ytmsearch:no results', context)).toEqual({ loadType: 'empty' })
})

test('HTTP failures become source errors instead of empty results', async () => {
	const context = await makeContext()
	spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad Request', { status: 400 }))
	expect(await YoutubeSource.loadTrack('ytmsearch:slayr', context)).toEqual({
		loadType: 'error', message: 'YouTube search failed'
	})
})
