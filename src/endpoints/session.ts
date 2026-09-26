import { findSession } from '../players/sessions'
import type { Endpoint } from '../shared/endpoints'
import { httpError, routeParams } from '../shared/endpoints'

export const updateSessionEndpoint: Endpoint = {
  path: '/v4/sessions/:sessionId',
  method: 'PATCH',
  description: 'Updates a session resuming state and timeout',
  handle: async (request) => {
    const { sessionId } = routeParams(request)
    const path = new URL(request.url).pathname
    if (!sessionId) {
      return httpError(400, 'Bad Request', 'Missing sessionId.', path)
    }
    let body: { resuming?: unknown; timeout?: unknown } = {}
    const text = await request.text()
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as { resuming?: unknown; timeout?: unknown }
      } catch {
        return httpError(400, 'Bad Request', 'Invalid JSON body.', path)
      }
    }
    const session = findSession(sessionId)
    if (!session) {
      return httpError(
        404,
        'Not Found',
        'Unknown session. Open a /v4/websocket connection first.',
        path
      )
    }
    if (body.resuming !== undefined) {
      if (typeof body.resuming !== 'boolean') {
        return httpError(
          400,
          'Bad Request',
          'Resuming must be a boolean.',
          path
        )
      }
      session.resuming = body.resuming
    }
    if (body.timeout !== undefined) {
      if (
        typeof body.timeout !== 'number' ||
        !Number.isFinite(body.timeout) ||
        body.timeout <= 0
      ) {
        return httpError(
          400,
          'Bad Request',
          'Timeout must be a number above 0.',
          path
        )
      }
      session.timeout = Math.trunc(body.timeout)
    }
    return Response.json({
      resuming: session.resuming,
      timeout: session.timeout
    })
  }
}
