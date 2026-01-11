// src/index.ts
import process from 'node:process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { type ServerWebSocket } from 'bun'
import { logger } from './utils'
import { Router } from './managers/routerManager'
import type { ConfigType, WSData, Session } from './types'

if (!process.isBun) {
  logger.fatal('TOOKA is bun exclusive atm, please use bun')
  process.exit(1)
}

const defaultConfig: ConfigType = {
  server: { port: 50166, host: '0.0.0.0', password: 'youshallnotpass' }
}

async function loadConfig(): Promise<ConfigType> {
  try {
    const module = await import(path.join(process.cwd(), 'config.ts'))
    return {
      server: {
        ...defaultConfig.server,
        ...(module.default?.server ?? {})
      }
    }
  } catch (e: any) {
    return defaultConfig
  }
}


const config = await loadConfig()

const tooka = {
  version: '0.0.1',
  gitInfo: { commitTime: Date.now() },
  options: { filters: { enabled: {} } }
}

const router = new Router({ tooka, logger, config })
await router.loadDir(path.join(import.meta.dir, 'endpoints'))

class WebsocketHandler extends EventEmitter {
  private readonly config: ConfigType
  private readonly router: Router

  private startedAt = Date.now()
  private connections = new Set<ServerWebSocket<WSData>>()
  private sessions = new Map<string, Session>()

  constructor(config: ConfigType, router: Router) {
    super()
    this.config = config
    this.router = router
  }

  private send(ws: ServerWebSocket<WSData>, payload: unknown) {
    ws.send(JSON.stringify(payload))
  }

  private header(req: Request, name: string) {
    return req.headers.get(name) ?? req.headers.get(name.toLowerCase())
  }

  startServer() {
    this.startedAt = Date.now()

    const serverPassword = this.config.server.password

    logger.info('Starting server...', {
      host: this.config.server.host,
      port: this.config.server.port
    })

    const server = Bun.serve<WSData>({
      port: this.config.server.port,
      hostname: this.config.server.host,

      fetch: async (req, bunServer) => {
        const url = new URL(req.url)

        if (url.pathname === '/v4/websocket') {
          if (req.method !== 'GET') {
            return new Response('Method Not Allowed', { status: 405 })
          }

          const remoteAddress = bunServer.requestIP(req)?.address || 'unknown'

          const auth = this.header(req, 'Authorization')
          const userId = this.header(req, 'User-Id')
          const clientName = this.header(req, 'Client-Name')
          const sessionIdHeader = this.header(req, 'Session-Id')

          if (!auth || auth !== serverPassword) {
            logger.warn('Invalid password', { remoteAddress })
            return new Response('Invalid password provided.', { status: 401 })
          }

          if (!userId) {
            logger.warn('Missing User-Id', { remoteAddress })
            return new Response('Missing User-Id header.', { status: 400 })
          }

          if (!clientName) {
            logger.warn('Missing Client-Name', { remoteAddress })
            return new Response('Missing Client-Name header.', { status: 400 })
          }

          let resumed = false
          let session: Session | undefined

          if (sessionIdHeader) {
            const existing = this.sessions.get(sessionIdHeader)
            if (existing && existing.userId === userId) {
              if (
                existing.resumeEnabled &&
                (!existing.resumeDeadline ||
                  existing.resumeDeadline > Date.now())
              ) {
                resumed = true
                session = existing
              }
            }
          }

          if (!session) {
            const newSessionId = crypto.randomUUID()
            session = {
              sessionId: newSessionId,
              userId,
              clientName,
              resumeEnabled: false,
              resumeTimeoutMs: 60_000
            }
            this.sessions.set(newSessionId, session)
          }

          const data: WSData = {
            id: crypto.randomUUID(),
            ip: remoteAddress,
            userId,
            clientName,
            sessionId: session.sessionId,
            resumed
          }

          const ok = bunServer.upgrade(req, { data })
          if (ok) return
          return new Response('WebSocket upgrade failed', { status: 400 })
        }

        return this.router.fetch(req, bunServer as any)
      },

      websocket: {
        open: (ws) => {
          this.connections.add(ws)

          const session = this.sessions.get(ws.data.sessionId)
          if (session) {
            session.ws = ws
            session.resumeDeadline = undefined
          }

          logger.info('WS connected', {
            userId: ws.data.userId,
            clientName: ws.data.clientName,
            sessionId: ws.data.sessionId,
            ip: ws.data.ip,
            resumed: ws.data.resumed,
            connections: this.connections.size
          })

          this.send(ws, {
            op: 'ready',
            resumed: ws.data.resumed,
            sessionId: ws.data.sessionId
          })
        },

        message: (ws, message) => {
          const text =
            typeof message === 'string'
              ? message
              : Buffer.from(message).toString('utf8')

          let payload: any
          try {
            payload = JSON.parse(text)
          } catch {
            return
          }

          if (payload?.op === 'configureResuming') {
            const timeoutSeconds = Number(payload?.timeout ?? 60)

            const session = this.sessions.get(ws.data.sessionId)
            if (!session) return

            session.resumeEnabled = true
            session.resumeTimeoutMs = Math.max(1, timeoutSeconds) * 1000

            logger.info('Configured resuming', {
              sessionId: session.sessionId,
              userId: session.userId,
              timeoutSeconds
            })
          }
        },

        close: (ws, code, reason) => {
          this.connections.delete(ws)

          const session = this.sessions.get(ws.data.sessionId)
          if (session) {
            session.ws = undefined
            if (session.resumeEnabled) {
              session.resumeDeadline = Date.now() + session.resumeTimeoutMs
            } else {
              this.sessions.delete(session.sessionId)
            }
          }

          logger.info('WS disconnected', {
            sessionId: ws.data.sessionId,
            userId: ws.data.userId,
            code,
            reason: String(reason),
            connections: this.connections.size
          })
        }
      }
    })

    logger.info('Server listening', {
      host: this.config.server.host,
      port: server.port
    })
  }
}

new WebsocketHandler(config, router).startServer()
