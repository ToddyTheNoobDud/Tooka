import type { Endpoint } from '../shared/endpoints/base'

export const VersionEndpoint: Endpoint = {
  path: '/version',
  method: 'GET',
  description: 'Returns tooka version',
  handle: () => {
    return new Response('1.0.0')
  }
}
