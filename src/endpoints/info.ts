import type { Endpoint } from '../shared/endpoints/base'
import type { InfoResponse } from '../types/endpoints/info.types'

// will separate this better one day.
//

// https://www.w3schools.com/js/js_temporal_instant.asp
// 
// const instant = Temporal.Now.instant()
// then for getting the epoch milliseconds: instant.epochMilliseconds
// This replaces Date.now(), but since this api is too new, im not gonna implement it.

function buildJson(): InfoResponse {
  return {
    version: {
      semver: '1.0.0',
      major: 1,
      minor: 0,
      patch: 0,
      preRelease: '0',
      build: 'tooka'
    },
    git: {
      branch: 'dev',
      commit: '50f819b',
      commitTime: Date.now()
    },
    bun: process.versions.bun,
    isTooka: true,
    sourceManagers: [],
    filters: [],
    plugins: []
  }
}

export const infoEndpoint: Endpoint = {
  path: '/v4/info',
  method: 'GET',
  description: 'Returns information about the server',
  handle: () => {
    return Response.json(buildJson())
  }
}
