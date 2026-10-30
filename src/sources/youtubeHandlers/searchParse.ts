import { encodeTrack } from '../../tracks/encoding'
import type { Track, TrackInfo } from '../../types/utils'

interface YoutubeText {
	simpleText?: string
	runs?: Array<{ text: string }>
}

interface YoutubeSearchResponse {
	contents?: {
		sectionListRenderer?: {
			contents: Array<{
				itemSectionRenderer?: {
					contents: Array<{
						compactVideoRenderer?: {
							videoId: string
							title: YoutubeText
							longBylineText?: YoutubeText
							shortBylineText?: YoutubeText
							lengthText?: YoutubeText
							unplayableText?: YoutubeText
							thumbnail?: { thumbnails: Array<{ url: string }> }
						}
					}>
				}
			}>
		}
	}
}

export function parseYtSearch(data: unknown): Track[] {
	const response = data as YoutubeSearchResponse

	const sections = response.contents?.sectionListRenderer?.contents ?? []

	const tracks: Track[] = []

	for (const section of sections) {
		for (const item of section.itemSectionRenderer?.contents ?? []) {
			const renderer = item.compactVideoRenderer

			if (!renderer || renderer.unplayableText) {
				continue
			}

			const title = renderer.title.simpleText ?? renderer.title.runs?.map((run) => run.text).join('')

			const authorText = renderer.longBylineText ?? renderer.shortBylineText

			const author = authorText?.simpleText ?? authorText?.runs?.map((run) => run.text).join('')

			const duration =
				renderer.lengthText?.simpleText ?? renderer.lengthText?.runs?.map((run) => run.text).join('')

			if (!renderer.videoId || !title || !duration) {
				continue
			}

			const durationParts = duration.split(':').map(Number)
			if (durationParts.some((part) => !Number.isFinite(part))) {
				continue
			}

			const info: TrackInfo = {
				identifier: renderer.videoId,
				title,
				author: author ?? 'Unknown Artist',
				length: durationParts.reduce((seconds, part) => seconds * 60 + part, 0) * 1000,
				isStream: false,
				isSeekable: true,
				uri: `https://www.youtube.com/watch?v=${renderer.videoId}`,
				artworkUrl: renderer.thumbnail?.thumbnails.at(-1)?.url ?? null,
				isrc: null,
				sourceName: 'youtube',
				position: 0
			}
			tracks.push({ encoded: encodeTrack(info), info, pluginInfo: {}, userData: {} })
		}
	}

	return tracks
}

interface MusicSearchResponse {
	contents?: {
		tabbedSearchResultsRenderer?: {
			tabs: Array<{
				tabRenderer: {
					selected?: boolean
					content?: {
						sectionListRenderer?: {
							contents: Array<{
								musicShelfRenderer?: {
									contents: Array<{
										musicResponsiveListItemRenderer?: {
											playlistItemData?: { videoId?: string }
											flexColumns: Array<{
												musicResponsiveListItemFlexColumnRenderer: {
													text: { runs: Array<{ text: string }> }
												}
											}>
											fixedColumns?: Array<{
												musicResponsiveListItemFixedColumnRenderer: {
													text: { runs: Array<{ text: string }> }
												}
											}>
											thumbnail?: {
												musicThumbnailRenderer: {
													thumbnail: { thumbnails: Array<{ url: string }> }
												}
											}
										}
									}>
								}
							}>
						}
					}
				}
			}>
		}
	}
}

export function parseYtMusicSearch(data: unknown): Track[] {
	const response = data as MusicSearchResponse

	const tabs = response.contents?.tabbedSearchResultsRenderer?.tabs ?? []

	const tab = tabs.find((entry) => entry.tabRenderer.selected) ?? tabs[0]

	const sections = tab?.tabRenderer.content?.sectionListRenderer?.contents ?? []

	const tracks: Track[] = []

	for (const section of sections) {
		for (const item of section.musicShelfRenderer?.contents ?? []) {
			const renderer = item.musicResponsiveListItemRenderer
			const identifier = renderer?.playlistItemData?.videoId

			if (!renderer || !identifier) {
				continue
			}

			const title = renderer.flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer.text.runs
				.map((run) => run.text)
				.join('')

			const author = renderer.flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer.text.runs[0]?.text

			const duration = renderer.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer.text.runs[0]?.text

			if (!title || !duration) {
				continue
			}

			const durationParts = duration.split(':').map(Number)
			if (durationParts.some((part) => !Number.isFinite(part))) {
				continue
			}

			const info: TrackInfo = {
				identifier,
				title,
				author: author ?? 'Unknown Artist',
				length: durationParts.reduce((seconds, part) => seconds * 60 + part, 0) * 1000,
				isStream: false,
				isSeekable: true,
				uri: `https://music.youtube.com/watch?v=${identifier}`,
				artworkUrl: renderer.thumbnail?.musicThumbnailRenderer.thumbnail.thumbnails.at(-1)?.url ?? null,
				isrc: null,
				sourceName: 'youtube',
				position: 0
			}
			tracks.push({ encoded: encodeTrack(info), info, pluginInfo: {}, userData: {} })
		}
	}

	return tracks
}
