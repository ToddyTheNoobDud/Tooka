/**
 * Base contract for HTTP endpoints, so code can be reused and stay
 * maintainable as endpoints scale.
 *
 * Example: path `/v4/info`, method `GET`, returns `200 OK`.
 *
 * To add an endpoint, export an object of this shape from
 * `src/endpoints/` and register it in `EndpointsManager`.
 */
import type pino from 'pino'
import type { ConfigProps } from '../../types/config/configmanager.types'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface EndpointContext {
  config: ConfigProps
  logger: pino.Logger
}

export interface Endpoint {
  path: string
  method: HttpMethod
  description: string
  handle(
    request: Request,
    context: EndpointContext
  ): Response | Promise<Response>
}
