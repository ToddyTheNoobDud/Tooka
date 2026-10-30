import { badRequest } from '../endpoints/playerHelpers'
import type { Context } from '../shared/context'
import type { UpdatePlayerBody } from '../shared/players'
import { resolveSingleTrack } from '../sources/index'
import { decodeTrack } from '../tracks/decoding'
import type { Track } from '../types/utils'
import { isRecord } from '../utils/json'
import type { Player } from './player'

interface TrackSpec {
	encoded?: string | null
	identifier?: string
	userData?: Record<string, unknown>
}

export async function applyTrack(
	player: Player,
	body: UpdatePlayerBody,
	noReplace: boolean,
	request: Request,
	context: Context
): Promise<Response | null> {
	const path = new URL(request.url).pathname
	const read = readTrackSpec(body, path)
	if ('error' in read) {
		return read.error
	}
	const spec = read.spec
	if (!spec) {
		return null
	}

	// noReplace keeps a playing track; only userData may be swapped in place.
	const replace = !(noReplace && player.track)
	if (!replace) {
		if (spec.userData !== undefined && player.track) {
			player.track.userData = spec.userData
		}
		return null
	}

	if (spec.encoded !== undefined) {
		if (spec.encoded === null) {
			player.setTrack(null)
		} else {
			let info: Track['info']
			try {
				info = decodeTrack(spec.encoded).info
			} catch {
				return badRequest('Invalid encoded track.', path)
			}
			player.setTrack({
				encoded: spec.encoded,
				info,
				pluginInfo: {},
				userData: spec.userData ?? {}
			})
		}
	} else if (spec.identifier !== undefined) {
		const resolved = await resolveSingleTrack(spec.identifier, context)
		if (!resolved) {
			context.logger.warn(`Player ${player.guildId} identifier had no match: ${spec.identifier.slice(0, 80)}.`)
			return badRequest('No matches found for identifier.', path)
		}
		if (spec.userData !== undefined) {
			resolved.userData = spec.userData
		}
		player.setTrack(resolved)
	} else if (spec.userData !== undefined && player.track) {
		player.track.userData = spec.userData
	}
	return null
}

// Reads whichever track spec the body carries: the modern `track` object
// or the legacy top-level encodedTrack/identifier fields. Spec-less bodies
// get a null spec.
function readTrackSpec(body: UpdatePlayerBody, path: string): { spec: TrackSpec | null } | { error: Response } {
	if (body.track !== undefined) {
		if (body.encodedTrack !== undefined || body.identifier !== undefined) {
			return {
				error: badRequest('track is mutually exclusive with encodedTrack and identifier.', path)
			}
		}
		return readModernTrackSpec(body.track, path)
	}
	if (body.encodedTrack !== undefined && body.identifier !== undefined) {
		return {
			error: badRequest('encodedTrack and identifier are mutually exclusive.', path)
		}
	}
	if (body.encodedTrack === undefined && body.identifier === undefined) {
		return { spec: null }
	}
	return { spec: { encoded: body.encodedTrack, identifier: body.identifier } }
}

function readModernTrackSpec(track: unknown, path: string): { spec: TrackSpec } | { error: Response } {
	if (!isRecord(track)) {
		return { error: badRequest('Invalid track object.', path) }
	}
	const { encoded, identifier } = track as {
		encoded?: unknown
		identifier?: unknown
	}
	if (encoded !== undefined && encoded !== null && typeof encoded !== 'string') {
		return { error: badRequest('Invalid encoded track.', path) }
	}
	if (identifier !== undefined && typeof identifier !== 'string') {
		return { error: badRequest('Invalid identifier.', path) }
	}
	if (encoded !== undefined && identifier !== undefined) {
		return {
			error: badRequest('encoded and identifier are mutually exclusive.', path)
		}
	}
	const userData = track.userData
	if (userData !== undefined && !isRecord(userData)) {
		return { error: badRequest('Invalid userData object.', path) }
	}
	return {
		spec: {
			encoded: encoded as string | null | undefined,
			identifier: identifier as string | undefined,
			userData: (userData ?? undefined) as Record<string, unknown> | undefined
		}
	}
}
