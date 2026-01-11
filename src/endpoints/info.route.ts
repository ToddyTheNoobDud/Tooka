import process from 'node:process'
import Ajv from 'ajv'
import type { Route } from '../managers/routerManager'
import { getVersion } from '../utils.js'

const ajv = new Ajv({ allErrors: true })

const V4InfoSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'buildTime',
    'git',
    'runtime',
    'isTooka',
    'sourceManagers',
    'filters',
    'plugins'
  ],
  properties: {
    version: {
      type: 'object',
      required: ['semver'],
      additionalProperties: true,
      properties: { semver: { type: 'string' } }
    },
    buildTime: {
      anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }]
    },
    git: { type: 'object', additionalProperties: true },
    runtime: {
      type: 'object',
      additionalProperties: false,
      required: ['bun', 'node'],
      properties: {
        bun: { type: 'string' },
        node: { type: 'string' }
      }
    },
    isTooka: { type: 'boolean' },
    sourceManagers: { type: 'array', items: { type: 'string' } },
    filters: { type: 'array', items: { type: 'string' } },
    plugins: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'version', 'author', 'path'],
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          author: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          path: { anyOf: [{ type: 'string' }, { type: 'null' }] }
        }
      }
    }
  }
} as const

const validateV4Info = ajv.compile(V4InfoSchema)

async function getSourceManagers(tooka: any): Promise<string[]> {
  if (tooka?.workerManager) {
    if (tooka.supportedSourcesCache) return tooka.supportedSourcesCache
    const sources = (await tooka.getSourcesFromWorker?.()) ?? []
    tooka.supportedSourcesCache = sources
    return sources
  }
  if (tooka?.sources?.sources) return Array.from(tooka.sources.sources.keys())
  return []
}

function getEnabledFilters(tooka: any): string[] {
  const enabled = tooka?.options?.filters?.enabled ?? {}
  return Object.keys(enabled).filter((k) => enabled[k])
}

function getPlugins(tooka: any) {
  const pm = tooka?.pluginManager
  if (!pm?.loadedPlugins) return []
  return Array.from(pm.loadedPlugins.values()).map((p: any) => ({
    name: p.name,
    version: p.meta?.version || '0.0.0',
    author: p.meta?.author || null,
    path: p.path || null
  }))
}

export default function infoRoute(ctx: any): Route {
  return {
    method: 'GET',
    path: '/info',
    handler: async (req: Request) => {
      if (req.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 })
      }

      const tooka = ctx.tooka

      const response = {
        version: {
          semver: `${tooka?.version ?? '0.0.0'}`,
          ...(getVersion('object') as Record<string, unknown>)
        },
        buildTime: tooka?.gitInfo?.commitTime ?? null,
        git: tooka?.gitInfo ?? {},
        runtime: {
          bun: Bun.version,
          node: process.version
        },
        isTooka: true,
        sourceManagers: await getSourceManagers(tooka),
        filters: getEnabledFilters(tooka),
        plugins: getPlugins(tooka)
      }

      if (!validateV4Info(response)) {
        ctx.logger?.error?.('Invalid /v4/info response', {
          errors: validateV4Info.errors
        })
        return new Response('Internal Server Error', { status: 500 })
      }

      return Response.json(response, { status: 200 })
    }
  }
}
