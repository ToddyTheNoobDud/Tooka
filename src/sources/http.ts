import type { LoadResult, Source, SourceContext } from '../shared/sources'
import { encodeTrack } from '../tracks/encoding'
import type { Track, TrackInfo } from '../types/utils'
import { fetchResponse } from '../utils/http'

// this source will load wtv url we recive (and din't match a source), https:// for now.
export const httpSource: Source = {
  name: 'http',
  enabled: true,
  supportsSearch: false,
  searchPrefix: undefined,
  canResolve(identifier: string): boolean {
    return identifier.startsWith('https://')
  },
  // Catch-all: specific sources must win regardless of discovery order.
  fallback: true,
  // Direct file URL: nothing to resolve, ffmpeg reads it as-is.
  resolveStreamUrl: (pageUrl) => {
    return Promise.resolve({ url: pageUrl, authorization: null })
  },
  load: async (context: SourceContext) => {
    context.logger.info('HTTP source loaded')
  },
  loadTrack: async (identifier: string, context: SourceContext) => {
    return loadTrack(identifier, context)
  }
}

async function loadTrack(
  identifier: string,
  context: SourceContext
): Promise<LoadResult> {
  const response = await fetchResponse(identifier, context, {
    label: 'HTTP source probe'
  })
  if (!response) return { loadType: 'empty' }
  try {
    await response.body?.cancel()
  } catch {
    // body unneeded, headers are the verdict
  }
  const contentType = response.headers.get('content-type') ?? ''
  // Audio and video containers are playable (ffmpeg extracts the audio);
  // anything else is a web page or API payload, not a track.
  const playable =
    contentType.startsWith('audio/') ||
    contentType.startsWith('video/') ||
    contentType.includes('ogg')
  if (!response.ok || !playable) {
    return { loadType: 'empty' }
  }
  // Streams have no known metadata: length stays 0, clients treat
  // isStream tracks as open-ended.
  const info: TrackInfo = {
    identifier,
    author: 'Unknown Artist',
    length: 0,
    isStream: true,
    title: identifier,
    uri: identifier,
    artworkUrl: null,
    isrc: null,
    sourceName: 'http',
    position: 0,
    isSeekable: false
  }
  const track: Track = {
    encoded: encodeTrack(info),
    info,
    pluginInfo: {},
    userData: {}
  }
  return { loadType: 'track', track }
}
