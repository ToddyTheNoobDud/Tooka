import { badRequest, isRecord } from '../endpoints/playerHelpers'
import type { UpdatePlayerBody } from '../shared/players'
import type { SourceContext } from '../shared/sources'
import { resolveSingleTrack } from '../sources/index'
import { decodeTrack } from '../tracks/decoding'
import type { Track } from '../types/utils'
import type { Player } from './player'

export async function applyTrack(
  player: Player,
  body: UpdatePlayerBody,
  noReplace: boolean,
  request: Request,
  context: SourceContext
): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (
    body.track !== undefined &&
    (body.encodedTrack !== undefined || body.identifier !== undefined)
  ) {
    return badRequest(
      'track is mutually exclusive with encodedTrack and identifier.',
      path
    )
  }
  if (body.encodedTrack !== undefined && body.identifier !== undefined) {
    return badRequest(
      'encodedTrack and identifier are mutually exclusive.',
      path
    )
  }

  let spec: {
    encoded?: string | null
    identifier?: string
    userData?: Record<string, unknown>
  } | null = null
  if (body.track !== undefined) {
    if (!isRecord(body.track)) return badRequest('Invalid track object.', path)
    const raw = body.track as {
      encoded?: unknown
      identifier?: unknown
      userData?: unknown
    }
    if (
      raw.encoded !== undefined &&
      raw.encoded !== null &&
      typeof raw.encoded !== 'string'
    ) {
      return badRequest('Invalid encoded track.', path)
    }
    if (raw.identifier !== undefined && typeof raw.identifier !== 'string') {
      return badRequest('Invalid identifier.', path)
    }
    spec = {
      encoded: raw.encoded as string | null | undefined,
      identifier: raw.identifier as string | undefined,
      userData: raw.userData as Record<string, unknown> | undefined
    }
    if (spec.encoded !== undefined && spec.identifier !== undefined) {
      return badRequest('encoded and identifier are mutually exclusive.', path)
    }
  } else if (body.encodedTrack !== undefined || body.identifier !== undefined) {
    spec = {
      encoded: body.encodedTrack === undefined ? undefined : body.encodedTrack,
      identifier: body.identifier
    }
  }
  if (!spec) return null

  if (spec.userData !== undefined && !isRecord(spec.userData)) {
    return badRequest('Invalid userData object.', path)
  }
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
    } else if (typeof spec.encoded !== 'string') {
      return badRequest('Invalid encoded track.', path)
    } else {
      let info: Track['info']
      try {
        info = decodeTrack(spec.encoded).info
      } catch {
        return badRequest('Invalid encoded track.', path)
      }
      const track: Track = {
        encoded: spec.encoded,
        info,
        pluginInfo: {},
        userData: spec.userData ?? {}
      }
      player.setTrack(track)
    }
  } else if (spec.identifier !== undefined) {
    if (typeof spec.identifier !== 'string') {
      return badRequest('Invalid identifier.', path)
    }
    const resolved = await resolveSingleTrack(spec.identifier, context)
    if (!resolved) {
      context.logger.warn(
        `Player ${player.guildId} identifier had no match: ${spec.identifier.slice(0, 80)}.`
      )
      return badRequest('No matches found for identifier.', path)
    }
    if (spec.userData !== undefined) resolved.userData = spec.userData
    player.setTrack(resolved)
  } else if (spec.userData !== undefined && player.track) {
    player.track.userData = spec.userData
  }
  return null
}
