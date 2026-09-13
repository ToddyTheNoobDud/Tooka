/* Hoppefully this file will be the least code.
  I will just use this for loading everything else.
  For example, config globally, logger, etc.
  I will try my best to lazy load this thing.
 */

import pino from 'pino'
import { ConfigManager } from './managers/configmanager.ts'
import { WebSocketServer } from './server/websocket.ts'

const config = await new ConfigManager().load()

let logger: pino.Logger
if (config.logging.enableLogging) {
  logger = pino({ level: config.logging.level, transport: { target: 'pino-pretty' } })
} else {
  logger = pino({ level: 'silent' })
}

new WebSocketServer(config, logger).start()

logger.info('tooka has started.')

export { config, logger }
