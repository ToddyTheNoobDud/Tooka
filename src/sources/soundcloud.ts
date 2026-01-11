import { SourceManager, sourceManagerRegistry } from '../managers/sourceManager'
import { encodeTrack, decodeTrack, buildTrack, logger } from '../utils'
import { CredentialManager } from '../managers/credentialManager'
import type { TrackInfo, EncodedTrack } from '../types'
import type {
  SoundCloudTrack,
  SoundCloudSearchResponse
} from './types/soundcloud.types'
import {
  BASE_URL,
  SOUNDCLOUD_URL,
  ASSET_PATTERN,
  CLIENT_ID_PATTERN,
  URL_REGEX,
  SEARCH_PREFIX_LOWER
} from './types/soundcloud.types'

class SoundCloudSourceManager implements SourceManager {
  name = 'soundcloud'
  private credentialManager: CredentialManager
  private searchPrefixLength = SEARCH_PREFIX_LOWER.length

  constructor() {
    this.credentialManager = new CredentialManager(logger)
  }

  canHandle(url: string): boolean {
    const lower = url.toLowerCase()
    return lower.startsWith(SEARCH_PREFIX_LOWER) || URL_REGEX.test(url)
  }

  private async getSoundCloudClientId(): Promise<string | null> {
    const cachedClientId = this.credentialManager.get('soundcloud_client_id')
    if (cachedClientId) {
      return cachedClientId
    }

    try {
      const response = await fetch(SOUNDCLOUD_URL)
      if (!response.ok) {
        logger.error('Failed to load SoundCloud main page')
        return null
      }

      const mainPage = await response.text()

      const directMatch = mainPage.match(CLIENT_ID_PATTERN)
      if (directMatch?.[1]) {
        const clientId = directMatch[1]
        this.credentialManager.set('soundcloud_client_id', clientId)
        logger.info('SoundCloud client_id found in main page', { clientId })
        return clientId
      }

      const assetUrls = Array.from(
        mainPage.matchAll(ASSET_PATTERN),
        (m) => m[0]
      )
      if (assetUrls.length === 0) {
        logger.error('No SoundCloud asset URLs found')
        return null
      }

      const fetchAsset = async (url: string): Promise<string | null> => {
        try {
          const res = await fetch(url)
          if (!res.ok) return null

          const content = await res.text()
          const match = content.match(CLIENT_ID_PATTERN)
          return match?.[1] ?? null
        } catch {
          return null
        }
      }

      const results = await Promise.allSettled(assetUrls.map(fetchAsset))

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const clientId = result.value
          this.credentialManager.set('soundcloud_client_id', clientId)
          logger.info('SoundCloud client_id found in asset', { clientId })
          return clientId
        }
      }

      logger.error('client_id not found in any assets')
      return null
    } catch (err) {
      logger.error('SoundCloud initialization failed', { error: err })
      return null
    }
  }

  async search(query: string, limit: number = 10): Promise<TrackInfo[]> {
    const clientId = await this.getSoundCloudClientId()
    if (!clientId) {
      throw new Error('Failed to initialize SoundCloud client')
    }

    const trimmed = query.trim()
    if (!trimmed) {
      throw new Error('Search query cannot be empty')
    }

    const searchUrl = `${BASE_URL}/search/tracks?q=${encodeURIComponent(trimmed)}&client_id=${clientId}&limit=${limit}&offset=0&linked_partitioning=1`

    const response = await fetch(searchUrl)
    if (!response.ok) {
      throw new Error(`Search failed with status: ${response.status}`)
    }

    const data: SoundCloudSearchResponse = await response.json()

    if (!data.collection?.length) {
      return []
    }

    const tracks: TrackInfo[] = []
    for (let i = 0; i < data.collection.length; i++) {
      const item = data.collection[i]
      if (item.kind === 'track' && item.title) {
        tracks.push(this.buildTrackInfo(item))
      }
    }

    return tracks
  }

  private buildTrackInfo(item: SoundCloudTrack): TrackInfo {
    return buildTrack({
      title: item.title ?? 'Unknown',
      author: item.user?.username ?? 'Unknown',
      length: item.duration ?? 0,
      identifier: String(item.id ?? ''),
      isSeekable: true,
      isStream: false,
      uri: item.permalink_url ?? '',
      artworkUrl: item.artwork_url ?? null,
      isrc: item.publisher_metadata?.isrc ?? null,
      sourceName: 'soundcloud',
      position: 0
    })
  }

  async resolve(identifier: string): Promise<TrackInfo | TrackInfo[]> {
    const lower = identifier.toLowerCase()

    if (lower.startsWith(SEARCH_PREFIX_LOWER)) {
      const query = decodeURIComponent(
        identifier.substring(this.searchPrefixLength)
      )
      logger.info('SoundCloud search query', { query })
      return this.search(query)
    }

    if (URL_REGEX.test(identifier)) {
      return buildTrack({
        title: 'Sample SoundCloud Track',
        author: 'Sample Artist',
        length: 240000,
        identifier,
        isSeekable: true,
        isStream: false,
        uri: identifier,
        artworkUrl: null,
        isrc: null,
        sourceName: 'soundcloud',
        position: 0
      })
    }

    throw new Error(`Invalid SoundCloud identifier: ${identifier}`)
  }

  encode(track: TrackInfo): string {
    return encodeTrack(track)
  }

  decode(encoded: string): EncodedTrack {
    return decodeTrack(encoded)
  }
}

sourceManagerRegistry.register(new SoundCloudSourceManager())
