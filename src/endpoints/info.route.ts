import process from 'node:process'
import type { Route, Ctx } from '../types'
import { getVersion } from '../utils'

const V4_KEYS = new Set([
  'version',
  'buildTime',
  'git',
  'runtime',
  'isTooka',
  'sourceManagers',
  'filters',
  'plugins'
])
const RUNTIME_KEYS = new Set(['bun', 'node'])
const PLUGIN_KEYS = new Set(['name', 'version', 'author', 'path'])

function validateV4InfoLite(x: any): string[] | null {
  if (!x || typeof x !== 'object') return ['response must be an object']

  for (const k in x)
    if (!V4_KEYS.has(k)) return [`unexpected top-level key: ${k}`]
  for (const k of V4_KEYS) if (!(k in x)) return [`missing key: ${k}`]

  const v = x.version
  if (!v || typeof v !== 'object' || typeof v.semver !== 'string')
    return ['version.semver must be a string']

  const bt = x.buildTime
  if (!(bt === null || typeof bt === 'string' || typeof bt === 'number'))
    return ['buildTime must be string|number|null']

  if (!x.git || typeof x.git !== 'object') return ['git must be an object']
  if (typeof x.isTooka !== 'boolean') return ['isTooka must be boolean']

  const rt = x.runtime
  if (!rt || typeof rt !== 'object') return ['runtime must be an object']
  for (const k in rt)
    if (!RUNTIME_KEYS.has(k)) return [`unexpected runtime key: ${k}`]
  if (typeof rt.bun !== 'string' || typeof rt.node !== 'string')
    return ['runtime.bun and runtime.node must be strings']

  const sm = x.sourceManagers
  if (!Array.isArray(sm)) return ['sourceManagers must be an array']
  for (let i = 0; i < sm.length; i++)
    if (typeof sm[i] !== 'string') return ['sourceManagers must be string[]']

  const f = x.filters
  if (!Array.isArray(f)) return ['filters must be an array']
  for (let i = 0; i < f.length; i++)
    if (typeof f[i] !== 'string') return ['filters must be string[]']

  const pl = x.plugins
  if (!Array.isArray(pl)) return ['plugins must be an array']
  for (let i = 0; i < pl.length; i++) {
    const p = pl[i]
    if (!p || typeof p !== 'object') return [`plugins[${i}] must be an object`]
    for (const k in p)
      if (!PLUGIN_KEYS.has(k)) return [`unexpected plugins[${i}] key: ${k}`]
    for (const k of PLUGIN_KEYS)
      if (!(k in p)) return [`missing plugins[${i}].${k}`]
    if (typeof p.name !== 'string' || typeof p.version !== 'string')
      return [`plugins[${i}].name/version must be strings`]
    if (!(p.author === null || typeof p.author === 'string'))
      return [`plugins[${i}].author must be string|null`]
    if (!(p.path === null || typeof p.path === 'string'))
      return [`plugins[${i}].path must be string|null`]
  }

  return null
}

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
  const enabled = tooka?.options?.filters?.enabled
  if (!enabled) return []
  const out: string[] = []
  for (const k in enabled) if (enabled[k]) out.push(k)
  return out
}

function getPlugins(tooka: any) {
  const pm = tooka?.pluginManager
  const lp = pm?.loadedPlugins
  if (!lp) return []
  const out: any[] = []
  for (const p of lp.values()) {
    out.push({
      name: p.name,
      version: p.meta?.version || '0.0.0',
      author: p.meta?.author || null,
      path: p.path || null
    })
  }
  return out
}

export default function infoRoute(ctx: Ctx): Route {
  return {
    method: 'GET',
    path: '/info',
    handler: async () => {
      const tooka = ctx.tooka

      const response = {
        version: {
          semver: String(tooka?.version ?? '0.0.0'),
          ...(getVersion('object') as Record<string, unknown>)
        },
        buildTime: tooka?.gitInfo?.commitTime ?? null,
        git: tooka?.gitInfo ?? {},
        runtime: { bun: Bun.version, node: process.version },
        isTooka: true,
        sourceManagers: await getSourceManagers(tooka),
        filters: getEnabledFilters(tooka),
        plugins: getPlugins(tooka)
      }

      const errors = validateV4InfoLite(response)
      if (errors) {
        ctx.logger?.error?.('Invalid /v4/info response', { errors })
        return new Response('Internal Server Error', { status: 500 })
      }

      return Response.json(response)
    }
  }
}
