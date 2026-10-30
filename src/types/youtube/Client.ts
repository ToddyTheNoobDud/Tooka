import type { Track } from '../utils'

export interface BaseClient {
	client: {
		clientName: string
		clientVersion: string
		userAgent: string
		hl: string
		gl: string
		visitorData?: string
	}
	user: { lockedSafetyMode: boolean }
	request: { useSsl: boolean }
	search?: (query: string) => Promise<Track[]>
}

export interface AndroidClient extends BaseClient {
	client: BaseClient['client'] & {
		androidVersion?: string
		androidSdkVersion?: number
		deviceMake?: string
		deviceModel?: string
		osName?: string
	}
}

export type Client = AndroidClient
