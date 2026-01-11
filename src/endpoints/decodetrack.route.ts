import type { Route, Ctx } from '../types'
import { decodeTrack } from '../utils'

export default function decodeTrackRoute(ctx: Ctx): Route {
  return {
    method: 'GET',
    path: '/decodetrack',
    handler: async (req: Request) => {
      try {
        const url = new URL(req.url)
        const encoded = url.searchParams.get('encoded') || url.searchParams.get('encodedTrack')

        if (!encoded) {
          return new Response('Missing encoded parameter', { status: 400 })
        }

        const decoded = decodeTrack(encoded)
        return Response.json(decoded, { status: 200 })
      } catch (error) {
        ctx.logger?.error?.('Error decoding track', { error })
        return new Response('Internal Server Error', { status: 500 })
      }
    }
  }
}