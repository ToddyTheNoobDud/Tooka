import type {
  LoadResult,
  Source,
  SourceContext,
  StreamSource
} from '../shared/sources'
import { encodeTrack } from '../tracks/encoding'
import type { Track, TrackInfo } from '../types/utils'
import { fetchJson, fetchResponse, resolveRedirectUrl } from '../utils/http'

export const soundcloudSource: Source = {
  name: 'soundcloud',
  enabled: true,
  supportsSearch: true,
  searchPrefix: 'scsearch',
  canResolve: (identifier) =>
    isSoundcloudPage(identifier) || isShortLink(identifier),
  resolveStreamUrl: (pageUrl, context) => playableUrl(pageUrl, context),
  load: async (context) => {
    const sourceConfig = context.config.sources?.soundcloud
    const enabled = sourceConfig?.enable ?? true
    soundcloudSource.enabled = enabled
    if (!enabled) {
      context.logger.warn('SoundCloud source is disabled, skipping.')
      return
    }
    const clientId = await getClientId(context)
    if (!clientId.trim()) {
      throw new Error('SoundCloud clientId is empty, fix your config.toml.')
    }
    context.logger.info('SoundCloud source loaded.')
  },
  loadTrack: async (identifier, context) => {
    if (identifier.startsWith('scsearch:')) {
      return search(identifier.slice('scsearch:'.length), context)
    }
    if (isShortLink(identifier)) {
      const target = await resolveRedirectUrl(identifier, context)
      if (!target || !isSoundcloudPage(target)) return { loadType: 'empty' }
      return resolve(target, context)
    }
    if (isSoundcloudPage(identifier)) {
      return resolve(identifier, context)
    }
    return { loadType: 'empty' }
  }
}

async function search(
  query: string,
  context: SourceContext
): Promise<LoadResult> {
  if (!query.trim()) return { loadType: 'empty' }
  const params = new URLSearchParams({
    q: query,
    limit: String(context.config.sources.soundcloud.searchLimit),
    offset: '0',
    linked_partitioning: '0',
    client_id: await getClientId(context)
  })
  const response = await fetchResponse(
    `https://api-v2.soundcloud.com/search?${params}`,
    context,
    { label: 'SoundCloud search' }
  )
  if (!response) {
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
    const track = makeTrack(item)
    if (track) tracks.push(track)
  }
  if (tracks.length === 0) return { loadType: 'empty' }
  return { loadType: 'search', tracks }
}

async function resolve(
  url: string,
  context: SourceContext
): Promise<LoadResult> {
  const params = new URLSearchParams({
    url,
    client_id: await getClientId(context)
  })
  const response = await fetchResponse(
    `https://api-v2.soundcloud.com/resolve?${params}`,
    context,
    { label: 'SoundCloud resolve' }
  )
  if (!response) {
    return { loadType: 'error', message: 'SoundCloud resolve failed' }
  }
  if (response.status === 404) return { loadType: 'empty' }
  if (!response.ok) {
    context.logger.warn(
      `SoundCloud resolve failed with status ${response.status}.`
    )
    return { loadType: 'error', message: 'SoundCloud resolve failed' }
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    context.logger.warn({ err: error }, 'SoundCloud resolve returned bad JSON.')
    return { loadType: 'error', message: 'SoundCloud resolve failed' }
  }
  const playlist = await makePlaylist(body, context)
  if (playlist) {
    return {
      loadType: 'playlist',
      info: { name: playlist.name, selectedTrack: -1 },
      tracks: playlist.tracks
    }
  }
  const track = makeTrack(body)
  if (!track) return { loadType: 'empty' }
  return { loadType: 'track', track }
}

async function playableUrl(
  pageUrl: string,
  context: SourceContext
): Promise<StreamSource | null> {
  const params = new URLSearchParams({
    url: pageUrl,
    client_id: await getClientId(context)
  })
  const track = await fetchJson<Partial<SoundcloudApiTrack>>(
    `https://api-v2.soundcloud.com/resolve?${params}`,
    context,
    { label: 'SoundCloud stream resolve' }
  )
  if (!track) return null
  const stream = bestStream(track.media?.transcodings)
  if (!stream) {
    context.logger.warn('SoundCloud track has no playable transcoding.')
    return null
  }
  const transcodeUrl = new URL(stream.url)
  transcodeUrl.searchParams.set('client_id', await getClientId(context))
  return {
    url: await unwrapMediaUrl(transcodeUrl.toString(), context),
    authorization: track.track_authorization ?? null
  }
}

function bestStream(
  transcodings: SoundcloudTranscoding[] | undefined
): SoundcloudTranscoding | null {
  if (!transcodings || transcodings.length === 0) return null
  const isAac = (candidate: SoundcloudTranscoding): boolean =>
    (candidate.format?.mime_type.includes('aac') ?? false) ||
    candidate.preset.includes('aac')
  const preferences: Array<(candidate: SoundcloudTranscoding) => boolean> = [
    (candidate) => candidate.format?.protocol === 'hls' && isAac(candidate),
    (candidate) =>
      candidate.format?.protocol === 'progressive' &&
      (candidate.format?.mime_type.includes('mpeg') ?? false),
    (candidate) => candidate.format?.protocol === 'progressive',
    (candidate) =>
      candidate.format?.protocol === 'hls' &&
      (candidate.format?.mime_type.includes('mpeg') ?? false),
    (candidate) => candidate.format?.protocol === 'hls'
  ]
  for (const matches of preferences) {
    const hit = transcodings.find(matches)
    if (hit) return hit
  }
  return null
}

async function unwrapMediaUrl(
  url: string,
  context: SourceContext
): Promise<string> {
  const body = await fetchJson<{ url?: unknown }>(url, context, {
    label: 'SoundCloud media resolve'
  })
  if (typeof body?.url !== 'string' || body.url.length === 0) return url
  return body.url
}

function isSoundcloudPage(input: string): boolean {
  return input.includes('soundcloud.com/')
}

function isShortLink(input: string): boolean {
  try {
    return new URL(input).hostname === 'on.soundcloud.com'
  } catch {
    return false
  }
}

const clientIdPattern = /client_id["':=\s]+["']?([A-Za-z0-9]{32})/

let cachedClientId: string | undefined

async function getClientId(context: SourceContext): Promise<string> {
  if (cachedClientId !== undefined) return cachedClientId
  const configured = context.config.sources?.soundcloud?.clientId
  if (configured?.trim()) {
    cachedClientId = configured
    return cachedClientId
  }
  context.logger.warn('SoundCloud clientId is not set, scraping one.')
  cachedClientId = (await scrapeClientId(context)) ?? ''
  return cachedClientId
}

async function scrapeClientId(
  context: SourceContext
): Promise<string | undefined> {
  const response = await fetchResponse('https://soundcloud.com', context, {
    label: 'SoundCloud home page'
  })
  if (!response?.ok) {
    context.logger.warn('Failed to scrape SoundCloud client id.')
    return undefined
  }
  let page: string
  try {
    page = await response.text()
  } catch (error) {
    context.logger.warn(
      { err: error },
      'Failed to scrape SoundCloud client id.'
    )
    return undefined
  }
  const bundles: string[] = []
  for (const match of page.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const src = match[1]
    if (src?.includes('a-v2.sndcdn.com')) bundles.push(src)
  }
  const keys = await Promise.all(
    bundles.map((bundle) => scrapeBundle(bundle, context))
  )
  return keys.find((key) => key !== undefined)
}

async function scrapeBundle(
  src: string,
  context: SourceContext
): Promise<string | undefined> {
  const response = await fetchResponse(src, context, { label: 'bundle scrape' })
  if (!response?.ok) return undefined
  try {
    return (await response.text()).match(clientIdPattern)?.[1]
  } catch {
    return undefined
  }
}

function makeTrack(item: unknown): Track | null {
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

async function makePlaylist(
  item: unknown,
  context: SourceContext
): Promise<{ name: string; tracks: Track[] } | null> {
  if (!item || typeof item !== 'object') return null
  const raw = item as Partial<SoundcloudApiPlaylist>
  if (raw.kind !== 'playlist' || typeof raw.title !== 'string') return null
  if (!Array.isArray(raw.tracks)) return null
  const stubIds = raw.tracks.map(stubTrackId).filter((id) => id !== null)
  const full =
    stubIds.length > 0 ? await fillStubs(stubIds, context) : new Map()
  const tracks: Track[] = []
  let skipped = 0
  raw.tracks.forEach((entry) => {
    const id = stubTrackId(entry)
    const track = makeTrack(id !== null ? (full.get(id) ?? entry) : entry)
    if (track) {
      tracks.push(track)
      return
    }
    // No id to look up: deleted/private tombstone, nothing playable.
    skipped += 1
  })
  if (skipped > 0) {
    context.logger.warn(
      `SoundCloud playlist "${raw.title}": skipped ${skipped} unplayable entr${skipped === 1 ? 'y' : 'ies'}.`
    )
  }
  if (tracks.length === 0) return null
  return { name: raw.title, tracks }
}

function stubTrackId(entry: unknown): number | null {
  const raw = entry as { id?: unknown; urn?: unknown }
  if (!entry || typeof entry !== 'object') return null
  if (typeof raw.urn === 'string') return null
  return typeof raw.id === 'number' && Number.isInteger(raw.id) ? raw.id : null
}

async function fillStubs(
  ids: number[],
  context: SourceContext
): Promise<Map<number, unknown>> {
  const full = new Map<number, unknown>()
  for (let offset = 0; offset < ids.length; offset += 50) {
    const params = new URLSearchParams({
      ids: ids.slice(offset, offset + 50).join(','),
      client_id: await getClientId(context)
    })
    const body = await fetchJson<unknown[]>(
      `https://api-v2.soundcloud.com/tracks?${params}`,
      context,
      { label: 'SoundCloud track hydrate' }
    )
    if (!Array.isArray(body)) continue
    for (const track of body) {
      if (track && typeof track === 'object') {
        const id = (track as { id?: unknown }).id
        if (typeof id === 'number') full.set(id, track)
      }
    }
  }
  return full
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
  track_authorization?: string
  media?: {
    transcodings?: SoundcloudTranscoding[]
  }
}

interface SoundcloudApiPlaylist {
  kind?: string
  title: string
  tracks?: unknown[]
}

interface SoundcloudTranscoding {
  url: string
  preset: string
  format?: {
    protocol: string
    mime_type: string
  }
}
