import type { Route, Ctx } from '../types'
import { encodeTrack } from '../utils'
import Ajv from 'ajv'

const ajv = new Ajv({ allErrors: true })

const trackSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['track'],
  properties: {
    track: { type: 'object' }
  }
} as const

const validateTrack = ajv.compile(trackSchema)

export default function encodeTrackRoute(ctx: Ctx): Route {
  return {
    method: 'GET',
    path: '/encodetrack',
    handler: async (req: Request) => {
      try {
        const url = new URL(req.url)
        const trackParam = url.searchParams.get('track')

        if (!trackParam) {
          return new Response('Missing track parameter', { status: 400 })
        }

        let track: any
        try {
          track = JSON.parse(trackParam)
        } catch {
          return new Response('Invalid JSON in track parameter', { status: 400 })
        }

        const body = { track }

        if (!validateTrack(body)) {
          ctx.logger?.warn?.('Invalid track payload', {
            errors: validateTrack.errors
          })
          return new Response('Bad Request', { status: 400 })
        }

        const encoded = encodeTrack(body.track)
        return new Response(encoded, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        })
      } catch (error) {
        ctx.logger?.error?.('Error encoding track', { error })
        return new Response('Internal Server Error', { status: 500 })
      }
    }
  }
}