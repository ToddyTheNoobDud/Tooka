import type { Endpoint } from '../shared/endpoints'
import { resolveSource } from '../sources/index'

export const loadTracksEndpoint: Endpoint = {
  path: '/v4/loadtracks',
  method: 'GET',
  description: 'Search for tracks',
  handle: async (request, context) => {
    const identifier = new URL(request.url).searchParams.get('identifier')
    if (!identifier) {
      return Response.json({ message: 'Missing identifier' }, { status: 400 })
    }
    const source = resolveSource(identifier)
    if (!source) {
      return Response.json({ loadType: 'empty', data: {} })
    }
    const result = await source.loadTrack(identifier, {
      config: context.config,
      logger: context.logger
    })
    const count =
      result.loadType === 'search'
        ? result.tracks.length
        : result.loadType === 'track'
          ? 1
          : result.loadType === 'playlist'
            ? result.tracks.length
            : 0
    context.logger.debug(
      `loadtracks ${identifier.slice(0, 60)} -> ${result.loadType} (${count}).`
    )
    switch (result.loadType) {
      case 'empty':
        return Response.json({ loadType: 'empty', data: {} })
      case 'error':
        return Response.json({
          loadType: 'error',
          data: {
            message: result.message,
            severity: 'common',
            cause: 'unknown'
          }
        })
      case 'track':
        return Response.json({ loadType: 'track', data: result.track })
      case 'search':
        return Response.json({ loadType: 'search', data: result.tracks })
      case 'playlist':
        return Response.json({
          loadType: 'playlist',
          data: {
            info: result.info,
            tracks: result.tracks,
            pluginInfo: {}
          }
        })
    }
  }
}
