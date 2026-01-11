import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Ctx, Server, Handler, Route, RouteFactory } from '../types'

function joinPaths(prefix: string, p: string) {
  const a = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  const b = p.startsWith('/') ? p : `/${p}`
  return `${a}${b}`
}

export class Router {
  private routes = new Map<string, Handler>()

  constructor(
    private ctx: Ctx,
    private basePath = '/v4'
  ) {}

  register(route: Route) {
    const method = route.method.toUpperCase()

    if (!route.path?.startsWith('/')) {
      throw new Error(
        `Route path must start with "/": ${route.method} ${route.path}`
      )
    }

    if (
      route.path === this.basePath ||
      route.path.startsWith(this.basePath + '/')
    ) {
      throw new Error(
        `Do not include "${this.basePath}" in route.path. Use "/info" not "${this.basePath}/info". Got: ${route.path}`
      )
    }

    const fullPath = joinPaths(this.basePath, route.path)
    const key = `${method} ${fullPath}`

    if (this.routes.has(key)) throw new Error(`Duplicate route: ${key}`)
    this.routes.set(key, route.handler)
  }

  async loadDir(dirAbs: string) {
    const glob = new Bun.Glob('**/*.route.{ts,js}')

    for await (const rel of glob.scan(dirAbs)) {
      const abs = path.join(dirAbs, rel)
      const mod = await import(pathToFileURL(abs).href)

      const factory: RouteFactory | undefined = mod.default
      if (typeof factory !== 'function') {
        throw new Error(
          `Route file must default-export a function(ctx) => route: ${abs}`
        )
      }

      const route = await factory(this.ctx)
      if (
        !route?.method ||
        !route?.path ||
        typeof route.handler !== 'function'
      ) {
        throw new Error(`Invalid route returned by: ${abs}`)
      }

      this.register(route)
    }
  }

  fetch = async (req: Request, server: Server): Promise<Response> => {
    const url = new URL(req.url)
    const key = `${req.method.toUpperCase()} ${url.pathname}`

    const handler = this.routes.get(key)
    if (!handler) {
      return new Response('Not Found', { status: 404 })
    }

    try {
      return await handler(req, server, this.ctx)
    } catch (error) {
      this.ctx.logger?.error?.('Route handler error', { error, key })
      return new Response('Internal Server Error', { status: 500 })
    }
  }
}

export { Router as RouterManager }