import { readdir } from 'node:fs/promises'
import type { Source, SourceContext, StreamSource } from '../shared/sources'
import type { Track } from '../types/utils'

// Discovered at boot, not imported by hand: dropping a new <name>.ts that
// exports a `<name>Source` next to the others registers it. Specific sources
// always win over fallbacks (http) regardless of directory order.
export let sources: Source[] = []

function isSource(value: unknown): value is Source {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.load === 'function' &&
    typeof candidate.loadTrack === 'function'
  )
}

async function discoverSources(context: SourceContext): Promise<Source[]> {
  const found: Source[] = []
  let files: string[] = []
  try {
    files = (await readdir(import.meta.dir)).filter(
      (file) => file.endsWith('.ts') && file !== 'index.ts'
    )
  } catch (error) {
    context.logger.error({ err: error }, 'Source discovery failed.')
    return found
  }
  for (const file of files) {
    let module: Record<string, unknown>
    try {
      module = (await import(`./${file}`)) as Record<string, unknown>
    } catch (error) {
      context.logger.warn(
        { err: error, file },
        'Failed to import source, skipping it.'
      )
      continue
    }
    const exported = Object.values(module).filter(isSource)
    if (exported.length === 0) {
      context.logger.warn(`No source export in ${file}, skipping it.`)
      continue
    }
    if (exported.length > 1) {
      context.logger.warn(
        `${file} exports ${exported.length} sources, registering all of them.`
      )
    }
    found.push(...exported)
  }
  found.sort(
    (left, right) =>
      Number(left.fallback ?? false) - Number(right.fallback ?? false)
  )
  return found
}

export async function loadSources(context: SourceContext): Promise<void> {
  sources = await discoverSources(context)
  // Concurrent: source loads are independent (each touches only its own
  // module state), so a slow one never blocks the rest at boot.
  await Promise.all(sources.map((source) => loadSource(source, context)))
  const enabledCount = sources.filter((source) => source.enabled).length
  context.logger.info(`Loaded ${enabledCount}/${sources.length} source(s).`)
}

async function loadSource(
  source: Source,
  context: SourceContext
): Promise<void> {
  try {
    await source.load(context)
  } catch (error) {
    source.enabled = false
    context.logger.error(
      { err: error, source: source.name },
      'Source failed to load, disabling it.'
    )
  }
}

export function resolveSource(identifier: string): Source | undefined {
  const prefix = identifier.split(':')[0]
  for (const source of sources) {
    if (!source.enabled) continue
    if (source.searchPrefix && prefix === source.searchPrefix) {
      return source
    }
    if (source.canResolve?.(identifier)) {
      return source
    }
  }
  return undefined
}

export async function resolveSingleTrack(
  identifier: string,
  context: SourceContext
): Promise<Track | null> {
  const source = resolveSource(identifier)
  if (!source) return null
  const result = await source.loadTrack(identifier, context)
  return result.loadType === 'track' ? result.track : null
}

// Play-time stream lookup by the track's owning source. Stream URLs expire,
// so callers must invoke this per play, never cache the result.
export async function resolveTrackStream(
  track: Track,
  context: SourceContext
): Promise<StreamSource | null> {
  const uri = track.info.uri
  if (!uri) return null
  const source = sources.find(
    (candidate) => candidate.enabled && candidate.name === track.info.sourceName
  )
  if (!source?.resolveStreamUrl) {
    context.logger.warn(
      `No stream resolver for source "${track.info.sourceName}".`
    )
    return null
  }
  return source.resolveStreamUrl(uri, context)
}
