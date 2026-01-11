import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { logger } from '../utils'

export async function loadSources(sourcesDir: string): Promise<void> {
  const glob = new Bun.Glob('*.ts')
  const loadPromises: Promise<void>[] = []

  logger.info('Loading source managers...', { directory: sourcesDir })

  for await (const rel of glob.scan(sourcesDir)) {
    const abs = path.join(sourcesDir, rel)

    loadPromises.push(
      import(pathToFileURL(abs).href)
        .then(() => {
          logger.debug('Loaded source manager', { file: rel })
        })
        .catch((error) => {
          logger.error('Failed to load source manager', {
            file: rel,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        })
    )
  }

  await Promise.all(loadPromises)

  logger.info('Source managers loaded', { count: loadPromises.length })
}