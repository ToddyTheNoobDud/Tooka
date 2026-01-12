import { sourceManagerRegistry } from '../managers/sourceManager'
import type { Route, Ctx } from '../types'
import { q, getRequired } from '../utils/query'

export default function loadTracksRoute(ctx: Ctx): Route {
  return {
    method: 'GET',
    path: '/loadtracks',
    handler: async (req: Request) => {
      try {
        const identifier = getRequired(q(req), 'identifier')
        if (!identifier)
          return new Response('Missing identifier parameter', { status: 400 })

        const manager = sourceManagerRegistry.findManager(identifier)
        if (!manager) {
          return Response.json({
            loadType: 'error',
            data: {
              message: `No source manager found for identifier: ${identifier}`,
              severity: 'common',
              cause: 'Unknown'
            }
          })
        }

        const result = await manager.resolve(identifier)

        if (!Array.isArray(result)) {
          return Response.json({
            loadType: 'track',
            data: {
              encoded: manager.encode(result),
              info: result,
              pluginInfo: {}
            }
          })
        }

        if (result.length === 0)
          return Response.json({ loadType: 'empty', data: {} })

        return Response.json({
          loadType: 'search',
          data: result.map((track) => ({
            encoded: manager.encode(track),
            info: track,
            pluginInfo: {}
          }))
        })
      } catch (error) {
        ctx.logger?.error?.('Error loading tracks', { error })
        return Response.json({
          loadType: 'error',
          data: {
            message: error instanceof Error ? error.message : 'Unknown error',
            severity: 'fault',
            cause: 'Unknown'
          }
        })
      }
    }
  }
}
