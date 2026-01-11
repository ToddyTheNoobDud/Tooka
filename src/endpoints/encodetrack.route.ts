import type { Route, Ctx } from '../types'
import { encodeTrack } from '../utils'
import { q } from '../utils/query'

export default function encodeTrackRoute(ctx: Ctx): Route {
  return {
    method: 'GET',
    path: '/encodetrack',
    handler: async (req: Request) => {
      try {
        const trackParam = q(req).get('track')
        if (!trackParam) return new Response('Missing track parameter', { status: 400 })

        let track: unknown
        try {
          track = JSON.parse(trackParam)
        } catch {
          return new Response('Invalid JSON in track parameter', { status: 400 })
        }

        if (!track || typeof track !== 'object' || Array.isArray(track)) {
          ctx.logger?.warn?.('Invalid track payload', {
            errors: ['track must be a JSON object']
          })
          return new Response('Bad Request', { status: 400 })
        }

        return new Response(encodeTrack(track), {
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