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
  logging: {
    level: Level
    enableLogging: boolean
    logRequests: boolean
  }
  config: { disableConfigCheck: boolean }
  session: { defaultTimeout: number }
  player: { updateIntervalMs: number; stuckThresholdMs: number }
  voice: {
    handshakeTimeoutMs: number
    discoveryTimeoutMs: number
    keepAliveIntervalMs: number
    encryption: 'auto' | 'aes' | 'xchacha'
    daveEnabled: boolean
  }
  audio: { bitrate: string }
  sources: {
    httpTimeoutMs: number
    soundcloud: { enable: boolean; clientId?: string; searchLimit: number }
  }
}
