/* Hoppefully this file will be the least code.
  I will just use this for loading everything else.
  For example, config globally, logger, etc.
  I will try my best to lazy load this thing.
 */

import pino from 'pino'
import { load } from './managers/configmanager.ts'
import { WebSocketServer } from './server/websocket.ts'
import { loadSources } from './sources/index.ts'

const config = await load()

let logger: pino.Logger
if (config.logging.enableLogging) {
  logger = pino({
    level: config.logging.level,
    transport: { target: 'pino-pretty' }
  })
} else {
  logger = pino({ level: 'silent' })
}

await loadSources({ config, logger })

const server = new WebSocketServer(config, logger)
server.start()

function handleErrors(error: Error, isExit: boolean, logger: pino.Logger) {
  logger.error(error)
  if (isExit) process.exit(1)
}

function handleShutdown(server: WebSocketServer, force?: boolean) {
  server.stop(force)
}

process.once('SIGINT', () => handleShutdown(server))
process.once('SIGTERM', () => handleShutdown(server))

process.on('uncaughtException', (error) => handleErrors(error, false, logger))
process.on('unhandledRejection', (reason) =>
  handleErrors(reason as Error, false, logger)
)
process.on('uncaughtExceptionMonitor', (error) =>
  handleErrors(error, true, logger)
)

logger.info('tooka has started.')

export { config, logger }
