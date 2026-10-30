import type pino from 'pino'
import type { ConfigProps } from '../types/config'

// Shared context threaded through sources, endpoints and voice glue.
export interface Context {
	config: ConfigProps
	logger: pino.Logger
}
