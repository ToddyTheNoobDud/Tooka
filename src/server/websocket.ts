// /* This file will handle all the websocket connections. */
// will be a class since its a long living thing.

// import { Serve } from 'bun'

// class WebSocketServer {
//   constructor() {
//     this
//   }
// }
// 
// todo.
// 

import type pino from 'pino'
import type { ConfigProps } from '../types/config/configmanager.types'

export class WebSocketServer {
  constructor(
    private readonly config: ConfigProps,
    private readonly logger: pino.Logger
  ) {}

  public async start() {
    const server = Bun.serve({
      port: this.config.server.port,
      fetch() {
        return new Response('Hello World')
      }
    })
    this.logger.info(`WebSocket server started on port ${server.url}`)
  }
}
