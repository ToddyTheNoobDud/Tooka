import type { Track } from '../types/utils'
import type { Player } from './player'

export interface SessionSocket {
  send(data: string | Buffer): void
}

export interface Session {
  id: string
  userId: string | null
  ws: SessionSocket | null
  resuming: boolean
  timeout: number
  players: Map<string, Player>
  expireTimer: ReturnType<typeof setTimeout> | null
}

const sessions = new Map<string, Session>()

const guildOwners = new Map<string, Session>()

export function attachPlayer(session: Session, player: Player): void {
  session.players.set(player.guildId, player)
  guildOwners.set(player.guildId, session)
}

export function detachPlayer(session: Session, guildId: string): void {
  session.players.delete(guildId)
  if (guildOwners.get(guildId) === session) guildOwners.delete(guildId)
}

// Sessions are born only on WebSocket open. REST handlers must use
// findSession and answer 404 for unknown ids - auto-creating here is what
// produced ghost sessions (and ghost players) from stale clients.
export function openSession(
  id: string,
  userId: string,
  ws: SessionSocket,
  defaultTimeout: number
): Session {
  const session: Session = {
    id,
    userId,
    ws,
    resuming: false,
    timeout: defaultTimeout,
    players: new Map(),
    expireTimer: null
  }
  sessions.set(id, session)
  return session
}

export function findSession(id: string): Session | undefined {
  return sessions.get(id)
}

export function allSessions(): Iterable<Session> {
  return sessions.values()
}

export function findSessionByGuild(guildId: string): Session | undefined {
  return guildOwners.get(guildId)
}

export interface PlayerStateSnapshot {
  time: number
  position: number
  connected: boolean
  ping: number
}

export function playerStateSnapshot(player: Player): PlayerStateSnapshot {
  const live =
    player.connection !== null && player.connection.state === 'connected'
  return {
    time: Date.now(),
    position: player.track ? player.position : 0,
    connected: live,
    ping: player.connection?.stats().ping ?? -1
  }
}

// Best-effort fan-out to the client owning a guild. False when the socket
// is gone (closed session, expiry race); never throws.
export function sendGuildOp(guildId: string, op: unknown): boolean {
  const ws = findSessionByGuild(guildId)?.ws
  if (!ws) return false
  try {
    ws.send(JSON.stringify(op))
    return true
  } catch {
    return false
  }
}

export function broadcastOp(op: unknown): void {
  const raw = JSON.stringify(op)
  for (const session of sessions.values()) {
    if (!session.ws) continue
    try {
      session.ws.send(raw)
    } catch {
      // closed socket, expiry will reap it
    }
  }
}

export function trackEventOp(
  type: 'TrackStartEvent' | 'TrackEndEvent',
  guildId: string,
  track: Track,
  reason?: 'finished' | 'loadFailed' | 'stopped' | 'replaced' | 'cleanup'
): Record<string, unknown> {
  return reason === undefined
    ? { op: 'event', type, guildId, track }
    : { op: 'event', type, guildId, track, reason }
}

export function destroySession(id: string): boolean {
  const session = sessions.get(id)
  if (!session) return false
  for (const player of session.players.values()) {
    // Inline playback teardown instead of importing voice/players:
    // sessions must not depend on the voice layer (import cycle), and the
    // connection destroy below already unregisters the ticker, so there is
    // nothing left to detach from.
    try {
      player[Symbol.dispose]()
    } catch {
      // already gone
    }
  }
  for (const guildId of session.players.keys()) {
    if (guildOwners.get(guildId) === session) guildOwners.delete(guildId)
  }
  session.players.clear()
  sessions.delete(id)
  return true
}
