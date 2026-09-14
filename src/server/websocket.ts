// /* This file will handle all the websocket connections. */
// will be a class since its a long living thing.

// still have a lot to do on this

import type pino from 'pino'
import { EndpointsManager } from '../managers/endpointsmanager'
import type { ConfigProps } from '../types/config/configmanager.types'

export class WebSocketServer {
  private server: ReturnType<typeof Bun.serve> | undefined

  constructor(
    private readonly config: ConfigProps,
    private readonly logger: pino.Logger
  ) {}

  public start() {
    const endpoints = new EndpointsManager(this.config, this.logger)
    const server = Bun.serve({
      port: this.config.server.port,
      hostname: this.config.server.host,
      routes: {
        '/': () => new Response('Hi'),
        ...endpoints.buildRoutes()
      },
      fetch() {
        return Response.json({ message: 'You should watch date a live.' })
      }
    })
    this.logger.info(`WebSocket server started on url ${server.url}`)
    this.server = server
  }

  public stop(force?: boolean) {
    if (this.server) {
      this.server.stop(force)
      this.logger.info('WebSocket server stopped')
    }
  }
}
