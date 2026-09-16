import type pino from 'pino'
import { infoEndpoint } from '../endpoints/info'
import { loadTracksEndpoint } from '../endpoints/loadtracks'
import { VersionEndpoint } from '../endpoints/version'

import type {
  Endpoint,
  EndpointContext,
  HttpMethod
} from '../shared/endpoints/base'
import type { ConfigProps } from '../types/config/configmanager.types'

type RouteHandler = (request: Request) => Response | Promise<Response>

/**
 * @description Owns the HTTP endpoints and builds the routes object Bun
 * expects, e.g. v4/info, v4/stats, etc.
 *
 * Endpoints are registered explicitly below. To add one, export it from
 * `src/endpoints/` and append it to the `endpoints` list.
 */
export class EndpointsManager {
  constructor(
    private readonly config: ConfigProps,
    private readonly logger: pino.Logger
  ) {}

  public buildRoutes(): Record<
    string,
    Partial<Record<HttpMethod, RouteHandler>>
  > {
    // i'll give prefence into manually registering endpoints, why?
    // i soon want to make it more customizable (so you can disable/enable any endpoint you want to)
    // or just make this register everything automatically,
    // mostly because i pretend to add: https://bun.sh/docs/runtime/http/server#hot-route-reloading
    // so i can reload the endpoints / update stuff without restarting tooka.

    const endpoints: Endpoint[] = [
      infoEndpoint,
      VersionEndpoint,
      loadTracksEndpoint
    ]
    const routes: Record<string, Partial<Record<HttpMethod, RouteHandler>>> = {}
    for (const endpoint of endpoints) {
      const handlers = routes[endpoint.path] ?? {}
      if (handlers[endpoint.method] !== undefined) {
        throw new Error(
          `Duplicate endpoint: ${endpoint.method} ${endpoint.path}`
        )
      }
      handlers[endpoint.method] = (request) => {
        return this.handleWithAuth(endpoint, request)
      }
      routes[endpoint.path] = handlers
    }
    this.logger.debug(`Registered ${endpoints.length} endpoint(s).`)
    return routes
  }

  private async handleWithAuth(
    endpoint: Endpoint,
    request: Request
  ): Promise<Response> {
    if (request.headers.get('Authorization') !== this.config.server.password) {
      return new Response('Unauthorized', { status: 401 })
    }
    const context: EndpointContext = {
      config: this.config,
      logger: this.logger
    }
    try {
      return await endpoint.handle(request, context)
    } catch (error) {
      this.logger.error(
        { error, method: endpoint.method, path: endpoint.path },
        'Endpoint handler threw.'
      )
      return Response.json({ error: 'Internal Server Error' }, { status: 500 })
    }
  }
}
