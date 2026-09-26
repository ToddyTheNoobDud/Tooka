import type { Player } from '../players/player'
import { findSession } from '../players/sessions'
import { httpError, routeParams } from '../shared/endpoints'
import type { UpdatePlayerBody, VoiceState } from '../shared/players'

export function badRequest(message: string, path: string): Response {
  return httpError(400, 'Bad Request', message, path)
}

export function notFound(message: string, path: string): Response {
  return httpError(404, 'Not Found', message, path)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function findPlayer(
  request: Request
):
  | { sessionId: string; guildId: string; player: Player }
  | { error: Response } {
  const { sessionId, guildId } = routeParams(request)
  const path = new URL(request.url).pathname
  if (!sessionId || !guildId) {
    return { error: badRequest('Missing sessionId or guildId.', path) }
  }
  const player = findSession(sessionId)?.players.get(guildId)
  if (!player) return { error: notFound('Player not found.', path) }
  return { sessionId, guildId, player }
}

export function validateVoice(voice: unknown): voice is VoiceState {
  if (!isRecord(voice)) return false
  // Null credentials mean "disconnected" (kicked/left, no DELETE coming);
  // anything else non-string is malformed.
  for (const key of ['token', 'endpoint', 'sessionId', 'channelId']) {
    const value = voice[key]
    if (value !== null && typeof value !== 'string') return false
  }
  return true
}

// A voice state without credentials is a disconnect notice, not a state
// to connect with. Normalize it so the rest of the code only sees either
// complete credentials or the empty state.
export function normalizeVoice(voice: VoiceState): VoiceState {
  return {
    token: voice.token ?? '',
    endpoint: voice.endpoint ?? '',
    sessionId: voice.sessionId ?? '',
    channelId: voice.channelId
  }
}

export function isVoiceDisconnect(voice: VoiceState): boolean {
  return !voice.token || !voice.endpoint || !voice.sessionId
}

export async function readBody(
  request: Request
): Promise<{ body: UpdatePlayerBody } | { error: Response }> {
  const path = new URL(request.url).pathname
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return { error: badRequest('Invalid JSON body.', path) }
  }
  if (!isRecord(parsed))
    return { error: badRequest('Invalid JSON body.', path) }
  return { body: parsed as UpdatePlayerBody }
}
