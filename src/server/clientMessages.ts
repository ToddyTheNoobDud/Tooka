import { Player } from '../players/player'
import { attachPlayer, findSession } from '../players/sessions'
import type { Context } from '../shared/context'
import { syncPlayerVoice } from '../voice/players'

export interface WsData {
	userId: string
	clientName: string
	sessionId?: string
	resumeId?: string
}

export async function handleClientMessage(
	ws: { data: WsData; send(data: string): void },
	message: string | Buffer,
	context: Context
): Promise<void> {
	const sessionId = ws.data.sessionId
	if (!sessionId) {
		context.logger.debug('Client message before session open, ignoring.')
		return
	}
	const session = findSession(sessionId)
	if (!session) {
		context.logger.debug(`Client message for unknown session ${sessionId}.`)
		return
	}
	if (typeof message !== 'string') {
		context.logger.debug('Client binary message ignored (text JSON expected).')
		return
	}
	let payload: { op?: unknown } & Record<string, unknown>
	try {
		payload = JSON.parse(message) as { op?: unknown } & Record<string, unknown>
	} catch {
		context.logger.debug('Client message is not JSON, ignoring.')
		return
	}
	switch (payload.op) {
		case 'voiceUpdate': {
			const guildId = payload.guildId
			const discordSessionId = payload.sessionId
			const event = payload.event as { token?: unknown; endpoint?: unknown } | undefined
			if (
				typeof guildId !== 'string' ||
				typeof discordSessionId !== 'string' ||
				typeof event?.token !== 'string' ||
				typeof event?.endpoint !== 'string'
			) {
				context.logger.debug('Malformed voiceUpdate op, ignoring.')
				return
			}
			context.logger.info(`voiceUpdate for guild ${guildId} (session ${sessionId}).`)
			let player = session.players.get(guildId)
			if (!player) {
				player = new Player(guildId)
				attachPlayer(session, player)
			}
			player.voice = {
				token: event.token,
				endpoint: event.endpoint,
				sessionId: discordSessionId,
				channelId: player.voice.channelId
			}
			await syncPlayerVoice(session, player, context)
			return
		}
		case 'configureResuming': {
			const timeout = payload.timeout
			if (typeof payload.key === 'string') {
				context.logger.debug('configureResuming key ignored (no resume support yet).')
			}
			if (typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0) {
				session.timeout = Math.trunc(timeout)
			}
			if (typeof payload.resuming === 'boolean') {
				session.resuming = payload.resuming
			}
			context.logger.debug(
				`Session ${sessionId} resuming config: resuming=${session.resuming} timeout=${session.timeout}s.`
			)
			return
		}
		default:
			context.logger.debug(`Unknown client op ${String(payload.op)}, ignoring.`)
	}
}
