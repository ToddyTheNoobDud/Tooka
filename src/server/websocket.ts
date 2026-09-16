// /* This file will handle all the websocket connections. */
// will be a class since its a long living thing.

// still have a lot to do on this

import type pino from 'pino'
import { EndpointsManager } from '../managers/endpointsmanager'
import type { ConfigProps } from '../types/config/configmanager.types'

// now related to the websocket
// 
import { handleUpgrade } from './websocket/upgrade'

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
        message(_ws, message) {
          console.log(message)
        },
        close(ws) {
          console.log(ws)
        }
      },
      fetch: (request, upgradeServer) => {
        if (
          request.headers.get('Authorization') !== this.config.server.password
        ) {
          this.logger.warn('Invalid authorization pass.')
          return new Response('Unauthorized', { status: 401 })
        }
        const upgraded = upgradeServer.upgrade(request)
        if (upgraded) {
          this.logger.info('WebSocket upgrade request received, client probaly connected with sucess.')
          return
        }
        return new Response('Not Found, also whatch date a live.', {
          status: 404
        })
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
