import Ajv from 'ajv'
import { sourceManagerRegistry } from '../managers/sourceManager'
import type { Route, Ctx } from '../types'

const ajv = new Ajv({ allErrors: true })

const loadTracksSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['identifier'],
  properties: {
    identifier: { type: 'string' }
  }
}

const validateLoadTracks = ajv.compile(loadTracksSchema)

export default function loadTracksRoute(ctx: Ctx): Route {
  return {
    method: 'GET',
    path: '/loadtracks',
    handler: async (req: Request) => {
      try {
        const url = new URL(req.url)
        const identifier = url.searchParams.get('identifier')

        if (!identifier) {
          return new Response('Missing identifier parameter', { status: 400 })
        }

        const body = { identifier }

        if (!validateLoadTracks(body)) {
          ctx.logger?.warn?.('Invalid loadTracks payload', {
            errors: validateLoadTracks.errors
          })
          return new Response('Bad Request', { status: 400 })
        }

        // Find the appropriate source manager
        const manager = sourceManagerRegistry.findManager(identifier)

        if (!manager) {
          return Response.json(
            {
              loadType: 'error',
              data: {
                message: `No source manager found for identifier: ${identifier}`,
                severity: 'common',
                cause: 'Unknown'
              }
            },
            { status: 200 }
          )
        }

        // Resolve the identifier
        const result = await manager.resolve(identifier)

        // Handle single track result
        if (!Array.isArray(result)) {
          return Response.json(
            {
              loadType: 'track',
              data: {
                encoded: manager.encode(result),
                info: result,
                pluginInfo: {}
              }
            },
            { status: 200 }
          )
        }

        // Handle empty results
        if (result.length === 0) {
          return Response.json(
            {
              loadType: 'empty',
              data: {}
            },
            { status: 200 }
          )
        }

        // Handle search results
        const tracks = result.map((track) => ({
          encoded: manager.encode(track),
          info: track,
          pluginInfo: {}
        }))

        return Response.json(
          {
            loadType: 'search',
            data: tracks
          },
          { status: 200 }
        )
      } catch (error) {
        ctx.logger?.error?.('Error loading tracks', { error })
        return Response.json(
          {
            loadType: 'error',
            data: {
              message: error instanceof Error ? error.message : 'Unknown error',
              severity: 'fault',
              cause: 'Unknown'
            }
          },
          { status: 200 }
        )
      }
    }
  }
}
