export type Ctx = {
  tooka: any
  logger: any
  config: any
}

export type Server = {
  upgrade(req: Request, opts?: any): boolean
  requestIP(req: Request): { address?: string } | null
}

export type Handler = (
  req: Request,
  server: Server,
  ctx: Ctx
) => Response | Promise<Response>

export type Route = {
  method: string
  path: string
  handler: Handler
}

export type RouteFactory = (ctx: Ctx) => Route | Promise<Route>

export type ConfigType = {
  server: { port: number; host: string; password: string }
}

export type WSData = {
  id: string
  ip?: string
  userId: string
  clientName: string
  sessionId: string
  resumed: boolean
}

export type Session = {
  sessionId: string
  userId: string
  clientName: string
  resumeEnabled: boolean
  resumeTimeoutMs: number
  resumeDeadline?: number
  ws?: any
}

export type TrackInfo = {
  title: string
  author: string
  length: number
  identifier: string
  isSeekable: boolean
  isStream: boolean
  uri?: string | null
  artworkUrl?: string | null
  isrc?: string | null
  sourceName: string
  position: number
}

export type EncodedTrack = {
  encoded: string
  info: TrackInfo
  details: (string | null)[]
  pluginInfo: Record<string, unknown>
  userData: Record<string, unknown>
}

const defaultConfig: ConfigType = {
  server: { port: 50166, host: '0.0.0.0', password: 'youshallnotpass' }
}
