import type { LoadResult, Source, SourceContext } from '../shared/sources/base'
import { encodeTrack } from '../tracks/encoding'
import type { Track, TrackInfo } from '../types/utils'

const clientIdPattern = /client_id["':=\s]+["']?([A-Za-z0-9]{32})/

let resolvedClientId: string | undefined

async function scrapeBundle(src: string): Promise<string | undefined> {
  try {
    const bundle = await (
      await fetch(src, { signal: AbortSignal.timeout(10000) })
    ).text()
    return bundle.match(clientIdPattern)?.[1]
  } catch {
    return undefined
  }
}

async function scrapeClientId(
  context: SourceContext
): Promise<string | undefined> {
  try {
    const page = await (
      await fetch('https://soundcloud.com', {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.00'
        }
      })
    ).text()
    const bundles: string[] = []
    for (const match of page.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      const src = match[1]
      if (src?.includes('a-v2.sndcdn.com')) bundles.push(src)
    }
    const keys = await Promise.all(bundles.map(scrapeBundle))
    return keys.find((key) => key !== undefined)
  } catch (error) {
    context.logger.warn({ error }, 'Failed to scrape SoundCloud client id.')
    return undefined
  }
}

async function resolveClientId(context: SourceContext): Promise<string> {
  if (resolvedClientId !== undefined) return resolvedClientId
  const configured = context.config.sources?.soundcloud?.clientId
  if (configured?.trim()) {
    resolvedClientId = configured
    return resolvedClientId
  }
  context.logger.warn('SoundCloud clientId is not set, scraping one.')
  resolvedClientId = (await scrapeClientId(context)) ?? ''
  return resolvedClientId
}

export const soundcloudSource: Source = {
  name: 'soundcloud',
  enabled: true,
  supportsSearch: true,
  searchPrefix: 'scsearch',
  load: async (context) => {
    const sourceConfig = context.config.sources?.soundcloud
    const enabled = sourceConfig?.enable ?? true
    soundcloudSource.enabled = enabled
    if (!enabled) {
      context.logger.warn('SoundCloud source is disabled, skipping.')
      return
    }
    const clientId = await resolveClientId(context)
    if (!clientId.trim()) {
      throw new Error('SoundCloud clientId is empty, fix your config.toml.')
    }
    context.logger.info('SoundCloud source loaded.')
  },
  loadTrack: async (identifier, context) => {
    if (identifier.startsWith('scsearch:')) {
      return searchTracks(identifier.slice('scsearch:'.length), context)
    }
    if (isSoundcloudUrl(identifier)) {
      return resolveTrack(identifier, context)
    }
    return { loadType: 'empty' }
  }
}

interface SoundcloudApiTrack {
  kind?: string
  id: number
  title: string
  duration: number
  permalink_url: string
  artwork_url: string | null
  urn: string
  user?: { username?: string } | null
  publisher_metadata?: { isrc?: string } | null
}

async function searchTracks(
  query: string,
  context: SourceContext
): Promise<LoadResult> {
  if (!query.trim()) return { loadType: 'empty' }
  const params = new URLSearchParams({
    q: query,
    limit: '10',
    offset: '0',
    linked_partitioning: '0',
    client_id: await resolveClientId(context)
  })
  let response: Response
  try {
    response = await fetch(`https://api-v2.soundcloud.com/search?${params}`, {
      signal: AbortSignal.timeout(10000)
    })
  } catch (error) {
    context.logger.warn({ error }, 'SoundCloud search request failed.')
    return { loadType: 'error', message: 'SoundCloud search failed' }
  }
  if (!response.ok) {
    context.logger.warn(
      `SoundCloud search failed with status ${response.status}.`
    )
    return { loadType: 'error', message: 'SoundCloud search failed' }
  }
  const data = (await response.json()) as { collection?: unknown }
  if (!Array.isArray(data.collection)) return { loadType: 'empty' }
  const tracks: Track[] = []
  for (const item of data.collection) {
    const track = toTrack(item)
    if (track) tracks.push(track)
  }
  if (tracks.length === 0) return { loadType: 'empty' }
  return { loadType: 'search', tracks }
}

function toTrack(item: unknown): Track | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Partial<SoundcloudApiTrack>
  if (raw.kind !== undefined && raw.kind !== 'track') return null
  if (
    typeof raw.title !== 'string' ||
    typeof raw.duration !== 'number' ||
    !Number.isFinite(raw.duration) ||
    typeof raw.urn !== 'string'
  ) {
    return null
  }
  const info: TrackInfo = {
    identifier: raw.urn,
    author: raw.user?.username ?? 'Unknown Artist',
    length: raw.duration,
    isStream: false,
    title: raw.title,
    uri: typeof raw.permalink_url === 'string' ? raw.permalink_url : null,
    artworkUrl: typeof raw.artwork_url === 'string' ? raw.artwork_url : null,
    isrc: raw.publisher_metadata?.isrc ?? null,
    sourceName: 'soundcloud',
    position: 0,
    isSeekable: true
  }
  return { encoded: encodeTrack(info), info, pluginInfo: {}, userData: {} }
}

async function resolveTrack(
  _url: string,
  _context: SourceContext
): Promise<LoadResult> {
  return { loadType: 'empty' }
}

function isSoundcloudUrl(input: string): boolean {
  return input.includes('soundcloud.com/')
}
