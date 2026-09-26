// /* This file will handle all the websocket connections. */
// will be a class since its a long living thing.

// still have a lot to do on this

import type pino from 'pino'
import { EndpointsManager } from '../managers/endpointsmanager'
import {
  broadcastOp,
  destroySession,
  findSession,
  openSession
} from '../players/sessions'
import { collectNodeStats } from '../stats'
import type { ConfigProps } from '../types/config'
import { handleClientMessage, type WsData } from './clientMessages'
import { startPlayerSweep } from './sweep'

const STATS_INTERVAL_MS = 60_000

export class WebSocketServer {
  private server: ReturnType<typeof Bun.serve> | undefined
  private playerUpdateTimer: ReturnType<typeof setInterval> | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly config: ConfigProps,
    private readonly logger: pino.Logger
  ) {}

  public start(): void {
    const endpoints = new EndpointsManager(this.config, this.logger)
    const logger = this.logger
    const config = this.config
    const server: ReturnType<typeof Bun.serve> = Bun.serve<WsData>({
      port: this.config.server.port,
      hostname: this.config.server.host,
      routes: {
        '/': () => new Response('Hi'),
        ...endpoints.buildRoutes()
      },
      websocket: {
        open(ws) {
          const requested = ws.data.resumeId
          const existing =
            requested !== undefined ? findSession(requested) : undefined
          if (existing?.resuming) {
            if (existing.expireTimer) {
              clearTimeout(existing.expireTimer)
              existing.expireTimer = null
            }
            existing.ws = ws
            ws.data.sessionId = existing.id
            logger.info(
              `Session ${existing.id} resumed for user ${ws.data.userId}.`
            )
            ws.send(
              JSON.stringify({
                op: 'ready',
                resumed: true,
                sessionId: existing.id
              })
            )
            return
          }
          const sessionId = generateSessionId()
          ws.data.sessionId = sessionId
          openSession(
            sessionId,
            ws.data.userId,
            ws,
            config.session.defaultTimeout
          )
          logger.info(
            `Session ${sessionId} opened for user ${ws.data.userId} (${ws.data.clientName}).`
          )
          ws.send(JSON.stringify({ op: 'ready', resumed: false, sessionId }))
        },
        message(ws, message) {
          void handleClientMessage(ws, message, logger, config).catch(
            (error) => {
              logger.warn({ err: error }, 'Client message handler threw.')
            }
          )
        },
        close(ws) {
          const sessionId = ws.data.sessionId
          if (!sessionId) return
          const session = findSession(sessionId)
          if (!session) return
          session.ws = null
          if (session.expireTimer) clearTimeout(session.expireTimer)
          // No resuming configured: destroy now. Holding players, voice
          // connections and ffmpeg processes for the timeout window is only
          // correct when the client asked to resume.
          if (!session.resuming) {
            session.expireTimer = null
            if (destroySession(sessionId)) {
              logger.info(
                `Session ${sessionId} closed, destroyed (no resuming).`
              )
            }
            return
          }
          logger.info(
            `Session ${sessionId} closed, destroying in ${session.timeout}s.`
          )
          const timer = setTimeout(() => {
            session.expireTimer = null
            if (destroySession(sessionId)) {
              logger.info(`Session ${sessionId} expired and destroyed.`)
            }
          }, session.timeout * 1000)
          timer.unref?.()
          session.expireTimer = timer
        }
      },
      fetch: (request, upgradeServer) => {
        if (
          request.headers.get('Authorization') !== this.config.server.password
        ) {
          this.logger.warn('Invalid authorization pass.')
          return new Response('Unauthorized', { status: 401 })
        }
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          return new Response('Not Found', { status: 404 })
        }
        const userId = request.headers.get('User-Id')
        const clientName = request.headers.get('Client-Name')
        if (!userId || !clientName) {
          this.logger.warn('Missing User-Id or Client-Name headers.')
          return new Response(
            'User-Id or Client-Name headers missing, Tooka requires both',
            { status: 401 }
          )
        }
        const resumeId = request.headers.get('Session-Id') ?? undefined
        const upgraded = upgradeServer.upgrade(request, {
          data: { userId, clientName, resumeId } as WsData
        })
        if (upgraded) {
          this.logger.debug(
            `WebSocket upgrade accepted for user ${userId} (${clientName}).`
          )
          return
        }
        return new Response('Not Found', { status: 404 })
      }
    })
    this.logger.info(`WebSocket server started on port ${server.port}`)
    this.server = server
    this.playerUpdateTimer = startPlayerSweep(config, logger)
    this.statsTimer = setInterval(() => {
      broadcastOp({ op: 'stats', ...collectNodeStats() })
    }, STATS_INTERVAL_MS)
    this.statsTimer.unref?.()
  }

  public stop(force?: boolean) {
    if (this.playerUpdateTimer) {
      clearInterval(this.playerUpdateTimer)
      this.playerUpdateTimer = null
    }
    if (this.statsTimer) {
      clearInterval(this.statsTimer)
      this.statsTimer = null
    }
    if (this.server) {
      this.server.stop(force)
      this.logger.info('WebSocket server stopped')
    }
  }
}

const SESSION_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

function generateSessionId(): string {
  let id: string
  do {
    let next = ''
    while (next.length < 16) {
      const byte = crypto.getRandomValues(new Uint8Array(1))[0] as number
      if (byte >= 252) continue
      next += SESSION_ID_CHARS[byte % 36]
    }
    id = next
  } while (findSession(id) !== undefined)
  return id
}
