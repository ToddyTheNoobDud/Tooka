import type { Endpoint } from '../shared/endpoints/base'

// will separate this better one day.
//

function buildJson(): string {
  // for now js return this hardcoded json
  return {
    version: {
      semver: '1.0.0',
      major: 1,
      minor: 0,
      patch: 0,
      preRelease: '0',
      build: 'tooka'
    },
    buildTime: Date.now(),
    git: {
      branch: 'dev',
      commit: '50f819b',
      commitTime: Date.now()
    },
    isTooka: true
  } as any
}

export const infoEndpoint: Endpoint = {
  path: '/v4/info',
  method: 'GET',
  description: 'Returns information about the server',
  handle: () => {
    return Response.json(buildJson())
  }
}
