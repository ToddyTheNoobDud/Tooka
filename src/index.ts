import process from 'node:process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { type ServerWebSocket } from 'bun'
import { logger } from './utils'
import { Router } from './managers/routerManager'
import { loadSources } from './managers/loadSourcesManager'
import { sourceManagerRegistry } from './managers/sourceManager'
import { loadConfig, type Config } from './configLoader'
import type { WSData, Session } from './types'

if (!process.isBun) {
  logger.fatal('TOOKA is bun exclusive atm, please use bun')
  process.exit(1)
}

interface AppContext {
  tooka: any
  logger: any
  config: Config
}

class Tooka extends EventEmitter {
  private readonly config: Config
  private readonly router: Router
  private readonly connections = new Set<ServerWebSocket<WSData>>()
  private readonly sessions = new Map<string, Session>()

  constructor(config: Config) {
    super()
    this.config = config
    this.router = new Router(this.createContext())
  }

  private createContext(): AppContext {
    const tooka = {
      version: '0.0.1',
      gitInfo: { commitTime: Date.now() },
      options: { filters: { enabled: {} } },
      sources: { sources: sourceManagerRegistry }
    }

    return {
      tooka,
      logger,
      config: this.config
    }
  }

  private send(ws: ServerWebSocket<WSData>, payload: unknown): void {
    ws.send(JSON.stringify(payload))
  }

  private getHeader(req: Request, name: string): string | null {
    return req.headers.get(name) ?? req.headers.get(name.toLowerCase())
  }

  async start(): Promise<void> {
    const now = performance.now()
    await loadSources(path.join(import.meta.dir, 'sources'))

    await this.router.loadDir(path.join(import.meta.dir, 'endpoints'))

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
          return this.handleWebSocketUpgrade(req, bunServer)
        }

        return this.router.fetch(req, bunServer as any)
      },

      websocket: {
        open: (ws) => this.handleWebSocketOpen(ws),
        message: (ws, message) => this.handleWebSocketMessage(ws, message),
        close: (ws, code, reason) => this.handleWebSocketClose(ws, code, reason)
      }
    })

    logger.info('Server listening', {
      host: this.config.server.host,
      port: server.port
    })
  }

  private handleWebSocketUpgrade(req: Request, bunServer: any): Response {
    if (req.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const remoteAddress = bunServer.requestIP(req)?.address || 'unknown'
    const auth = this.getHeader(req, 'Authorization')
    const userId = this.getHeader(req, 'User-Id')
    const clientName = this.getHeader(req, 'Client-Name')
    const sessionIdHeader = this.getHeader(req, 'Session-Id')

    if (!auth || auth !== this.config.server.password) {
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
          (!existing.resumeDeadline || existing.resumeDeadline > Date.now())
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
    if (ok) return new Response('Upgrade successful')
    return new Response('WebSocket upgrade failed', { status: 400 })
  }

  private handleWebSocketOpen(ws: ServerWebSocket<WSData>): void {
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
  }

  private handleWebSocketMessage(
    ws: ServerWebSocket<WSData>,
    message: any
  ): void {
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
      this.configureResuming(ws, payload)
    }
  }

  private configureResuming(ws: ServerWebSocket<WSData>, payload: any): void {
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

  private handleWebSocketClose(
    ws: ServerWebSocket<WSData>,
    code: number,
    reason: any
  ): void {
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

async function main(): Promise<void> {
  const config = await loadConfig()
  const app = new Tooka(config)
  await app.start()
}

main().catch((error) => {
  logger.error('Application startup failed', { error })
  process.exit(1)
})
