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

  public start(): void {
    const endpoints = new EndpointsManager(this.config, this.logger)
    const server: ReturnType<typeof Bun.serve> = Bun.serve<undefined>({
      port: this.config.server.port,
      hostname: this.config.server.host,
      routes: {
        '/': () => new Response('Hi'),
        ...endpoints.buildRoutes()
      },
      websocket: {
        message(ws, message) {
          console.log(message, ws)
        },
        close(ws) {
          console.log(ws)
        }
      },
      fetch: (request, upgradeServer) => {
        const isUpgrade =
          request.headers.get('upgrade')?.toLowerCase() === 'websocket'
        if (!isUpgrade) {
          return new Response('Not Found', { status: 404 })
        }
        if (
          request.headers.get('Authorization') !== this.config.server.password
        ) {
          this.logger.warn('Invalid authorization pass.')
          return new Response('Unauthorized', { status: 401 })
        }
        if (
          !request.headers.get('User-Id') ||
          !request.headers.get('Client-Name')
        ) {
          this.logger.warn('Missing User-Id or Client-Name headers.')
          return new Response(
            'User-Id or Client-Name headers missing, Tooka requires both',
            { status: 401 }
          )
        }
        const upgraded = upgradeServer.upgrade(request, {
          headers: { Iamtooka: 'true' }
        })
        if (upgraded) return
        return new Response('Not Found', { status: 404 })
      }
    })
    this.logger.info(`WebSocket server started on port ${server.port}`)
    this.server = server
  }

  public stop(force?: boolean) {
    if (this.server) {
      this.server.stop(force)
      this.logger.info('WebSocket server stopped')
    }
  }
}
