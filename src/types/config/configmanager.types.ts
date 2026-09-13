/* Types for the ConfigManager */
import type { Level } from 'pino'

/**
 * Resolved Tooka configuration.
 */
export interface ConfigProps {
  server: {
    port: number
    host: string
    password: string
    useHttp2: boolean
    useExperimentalHttp3: boolean
  }
  logging: { level: Level, enableLogging: boolean }
  config: { disableConfigCheck: boolean }
}
