import type { Route, Ctx } from '../types'
import { decodeTrack } from '../utils'
import { q } from '../utils/query'

export default function decodeTrackRoute(ctx: Ctx): Route {
  return {
    method: 'GET',
    path: '/decodetrack',
    handler: async (req: Request) => {
      try {
        const sp = q(req)
        const encoded = sp.get('encoded') || sp.get('encodedTrack')
        if (!encoded) return new Response('Missing encoded parameter', { status: 400 })

        return Response.json(decodeTrack(encoded), { status: 200 })
      } catch (error) {
        ctx.logger?.error?.('Error decoding track', { error })
        return new Response('Internal Server Error', { status: 500 })
      }
    }
  }
}