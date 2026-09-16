import type { Source, SourceContext } from '../shared/sources/base'
import { soundcloudSource } from './soundcloud'

export const sources: Source[] = [soundcloudSource]

export async function loadSources(context: SourceContext): Promise<void> {
  for (const source of sources) {
    try {
      await source.load(context)
    } catch (error) {
      source.enabled = false
      context.logger.error(
        { error, source: source.name },
        'Source failed to load, disabling it.'
      )
    }
  }
  const enabledCount = sources.filter((source) => source.enabled).length
  context.logger.info(`Loaded ${enabledCount}/${sources.length} source(s).`)
}

export function resolveSource(identifier: string): Source | undefined {
  const prefix = identifier.split(':')[0]
  for (const source of sources) {
    if (!source.enabled) continue
    if (source.searchPrefix && prefix === source.searchPrefix) {
      return source
    }
  }
  if (soundcloudSource.enabled && identifier.includes('soundcloud.com/')) {
    return soundcloudSource
  }
  return undefined
}
