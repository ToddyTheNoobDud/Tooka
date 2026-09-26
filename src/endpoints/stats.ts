import type { Endpoint } from '../shared/endpoints'
import { collectNodeStats } from '../stats'

export const statsEndpoint: Endpoint = {
  path: '/v4/stats',
  method: 'GET',
  description: 'Returns node statistics',
  handle: () => {
    return Response.json({ ...collectNodeStats(), frameStats: null })
  }
}
