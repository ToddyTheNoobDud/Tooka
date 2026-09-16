import type { Logger } from 'pino'

export function handleErrors(error: Error, isExit: boolean, logger: Logger) {
  logger.error(error)
  if (isExit) process.exit(1)
}
