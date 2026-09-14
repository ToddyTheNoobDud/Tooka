import type { WebSocketServer } from '../../server/websocket'

export function handleShutdown(server: WebSocketServer, force?: boolean) {
  server.stop(force)
}
