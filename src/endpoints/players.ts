import { applyTrack } from '../players/applyTrack'
import { Player } from '../players/player'
import {
  attachPlayer,
  detachPlayer,
  findSession,
  sendGuildOp,
  trackEventOp
} from '../players/sessions'
import type { Endpoint } from '../shared/endpoints'
import { routeParams } from '../shared/endpoints'
import { stopPlayback } from '../voice/playback'
import { syncPlayerVoice } from '../voice/players'
import {
  badRequest,
  findPlayer,
  isRecord,
  isVoiceDisconnect,
  normalizeVoice,
  readBody,
  validateVoice
} from './playerHelpers'

export const listPlayersEndpoint: Endpoint = {
  path: '/v4/sessions/:sessionId/players',
  method: 'GET',
  description: 'Returns all players of a session',
  handle: (request) => {
    const { sessionId } = routeParams(request)
    const players = sessionId
      ? [...(findSession(sessionId)?.players.values() ?? [])]
      : []
    return Response.json(players.map((player) => player.serialize()))
  }
}

export const getPlayerEndpoint: Endpoint = {
  path: '/v4/sessions/:sessionId/players/:guildId',
  method: 'GET',
  description: 'Returns a session player',
  handle: (request) => {
    const found = findPlayer(request)
    if ('error' in found) return found.error
    return Response.json(found.player.serialize())
  }
}

export const updatePlayerEndpoint: Endpoint = {
  path: '/v4/sessions/:sessionId/players/:guildId',
  method: 'PATCH',
  description: 'Updates or creates a session player',
  handle: async (request, context) => {
    const { sessionId, guildId } = routeParams(request)
    const url = new URL(request.url)
    if (!sessionId || !guildId) {
      return badRequest('Missing sessionId or guildId.', url.pathname)
    }
    const parsed = await readBody(request)
    if ('error' in parsed) return parsed.error
    const body = parsed.body

    if (
      body.volume !== undefined &&
      (!Number.isInteger(body.volume) || body.volume < 0 || body.volume > 1000)
    ) {
      return badRequest(
        'Volume must be an integer between 0 and 1000.',
        url.pathname
      )
    }
    if (body.paused !== undefined && typeof body.paused !== 'boolean') {
      return badRequest('Paused must be a boolean.', url.pathname)
    }
    if (
      body.position !== undefined &&
      (!Number.isFinite(body.position) || body.position < 0)
    ) {
      return badRequest('Position must be a number at least 0.', url.pathname)
    }
    if (
      body.endTime !== undefined &&
      body.endTime !== null &&
      (!Number.isFinite(body.endTime) || body.endTime <= 0)
    ) {
      return badRequest(
        'EndTime must be a number above 0 or null.',
        url.pathname
      )
    }
    if (body.filters !== undefined && !isRecord(body.filters)) {
      return badRequest('Invalid filters object.', url.pathname)
    }
    if (body.voice !== undefined && !validateVoice(body.voice)) {
      return badRequest('Invalid voice state object.', url.pathname)
    }

    const session = findSession(sessionId)
    if (!session) {
      return Response.json(
        {
          timestamp: Date.now(),
          status: 404,
          error: 'Not Found',
          message: 'Unknown session. Open a /v4/websocket connection first.',
          path: url.pathname
        },
        { status: 404 }
      )
    }
    const existed = session.players.has(guildId)
    const player = session.players.getOrInsertComputed(
      guildId,
      () => new Player(guildId)
    )
    if (!existed) attachPlayer(session, player)
    const noReplace = url.searchParams.get('noReplace') === 'true'

    const trackSpec =
      body.track !== undefined
        ? 'track{}'
        : body.encodedTrack !== undefined
          ? 'encodedTrack'
          : body.identifier !== undefined
            ? 'identifier'
            : 'none'
    // Structural updates (track/pause/voice) are worth an info line;
    // volume/position/filter tweaks are already covered by the -> request log.
    const structural =
      body.track !== undefined ||
      body.encodedTrack !== undefined ||
      body.identifier !== undefined ||
      body.paused !== undefined ||
      body.voice !== undefined
    const report = structural
      ? context.logger.info.bind(context.logger)
      : context.logger.debug.bind(context.logger)
    report(
      `Player ${guildId} PATCH (${trackSpec}, paused ${String(body.paused)}, noReplace ${String(noReplace)}).`
    )

    const previousTrack = player.track
    const trackError = await applyTrack(player, body, noReplace, request, {
      config: context.config,
      logger: context.logger
    })
    if (trackError) {
      if (!existed) detachPlayer(session, guildId)
      context.logger.warn(
        `Player ${guildId} update rejected (${trackError.status}).`
      )
      return trackError
    }
    if (body.volume !== undefined) player.volume = body.volume
    if (body.paused !== undefined) player.paused = body.paused
    // A seek restarts the transcoder at the new offset. Without this the
    // pump keeps emitting the old offset while position claims the new one,
    // and clients watch the delta sit at zero forever.
    const sought =
      body.position !== undefined &&
      Number.isFinite(body.position) &&
      Math.trunc(body.position) !== player.position
    if (body.position !== undefined)
      player.setPosition(Math.trunc(body.position))
    if (sought) stopPlayback(player)
    if (body.endTime !== undefined) player.endTime = body.endTime
    if (body.filters !== undefined) player.filters = body.filters
    if (body.voice !== undefined) {
      const voice = normalizeVoice(body.voice)
      if (isVoiceDisconnect(voice)) {
        // Kicked or left voice: no DELETE will come, so drop the connection
        // here or its heartbeat, UDP socket and DAVE session leak forever.
        // The player (track, position, pause) is kept for a later reconnect.
        player.voice = {
          token: '',
          endpoint: '',
          sessionId: '',
          channelId: null
        }
        stopPlayback(player)
        try {
          player.connection?.[Symbol.dispose]()
        } catch {
          // already gone
        }
        player.connection = null
      } else {
        player.voice = voice
      }
    }

    await syncPlayerVoice(session, player, context.config, context.logger)

    if (previousTrack && previousTrack.encoded !== player.track?.encoded) {
      sendGuildOp(
        guildId,
        trackEventOp(
          'TrackEndEvent',
          guildId,
          previousTrack,
          player.track ? 'replaced' : 'stopped'
        )
      )
    }

    report(
      `Player ${guildId} updated (track ${player.track ? `"${player.track.info.title}"` : 'none'}, paused ${player.paused}, volume ${player.volume}).`
    )
    return Response.json(player.serialize())
  }
}

export const destroyPlayerEndpoint: Endpoint = {
  path: '/v4/sessions/:sessionId/players/:guildId',
  method: 'DELETE',
  description: 'Destroys a session player',
  handle: (request) => {
    const found = findPlayer(request)
    if ('error' in found) return found.error
    const stoppedTrack = found.player.track
    stopPlayback(found.player)
    if (stoppedTrack) {
      sendGuildOp(
        found.guildId,
        trackEventOp('TrackEndEvent', found.guildId, stoppedTrack, 'stopped')
      )
    }
    try {
      found.player.connection?.[Symbol.dispose]()
    } catch {
      // already gone
    }
    found.player.connection = null
    const owner = findSession(found.sessionId)
    if (owner) detachPlayer(owner, found.guildId)
    return new Response(null, { status: 204 })
  }
}
