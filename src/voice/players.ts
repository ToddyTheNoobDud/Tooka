/* Binds players to voice connections. Single choke point: REST PATCH and
  the WS voiceUpdate op both funnel through ensurePlayerVoice. */

import type pino from 'pino'
import type { Player } from '../players/player'
import {
  playerStateSnapshot,
  type Session,
  sendGuildOp
} from '../players/sessions'
import type { ConfigProps } from '../types/config'
import { VoiceConnection } from './connection'
import { ensureDavey } from './dave'
import { advancePosition, syncPlayback } from './playback'

const pending = new Map<string, Promise<void>>()

export async function ensurePlayerVoice(
  session: Session,
  player: Player,
  config: ConfigProps,
  logger: pino.Logger
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const running = pending.get(player.guildId)
    if (running) {
      await running.catch(() => {
        // original caller already logged the failure
      })
      if (voiceMatches(player)) return
      continue
    }
    const task = connectPlayerVoice(session, player, config, logger).finally(
      () => {
        if (pending.get(player.guildId) === task) pending.delete(player.guildId)
      }
    )
    pending.set(player.guildId, task)
    await task
    return
  }
}

function voiceMatches(player: Player): boolean {
  const current = player.connection
  if (!current || current.state === 'destroyed') return false
  const voice = player.voice
  return current.matches({
    token: voice.token,
    endpoint: voice.endpoint,
    sessionId: voice.sessionId
  })
}

// The full voice+playback sync every entry point needs: connect (or reuse)
// the voice connection, then match the pump to player state.
export async function syncPlayerVoice(
  session: Session,
  player: Player,
  config: ConfigProps,
  logger: pino.Logger
): Promise<void> {
  await ensurePlayerVoice(session, player, config, logger)
  await syncPlayback(player, config, logger)
}

async function connectPlayerVoice(
  session: Session,
  player: Player,
  config: ConfigProps,
  logger: pino.Logger
): Promise<void> {
  const voice = player.voice
  if (!voice.token || !voice.endpoint || !voice.sessionId) {
    logger.debug(
      `Player ${player.guildId} has incomplete voice state, skipping voice connect.`
    )
    return
  }
  if (!voice.channelId) {
    logger.debug(
      `Player ${player.guildId} has no channelId yet, skipping voice connect.`
    )
    return
  }
  if (!session.userId) {
    logger.debug(
      `Session ${session.id} has no userId yet, skipping voice connect.`
    )
    return
  }
  const current = player.connection
  if (
    current &&
    current.state !== 'destroyed' &&
    current.matches({
      token: voice.token,
      endpoint: voice.endpoint,
      sessionId: voice.sessionId
    })
  ) {
    return
  }
  current?.[Symbol.dispose]()
  logger.info(
    `Connecting voice for guild ${player.guildId} (session ${session.id}).`
  )
  try {
    player.connection = await VoiceConnection.connect({
      endpoint: voice.endpoint,
      serverId: player.guildId,
      channelId: voice.channelId,
      userId: session.userId,
      sessionId: voice.sessionId,
      token: voice.token,
      logger,
      handshakeTimeoutMs: config.voice.handshakeTimeoutMs,
      discoveryTimeoutMs: config.voice.discoveryTimeoutMs,
      keepAliveIntervalMs: config.voice.keepAliveIntervalMs,
      encryption: config.voice.encryption,
      daveMaxVersion: config.voice.daveEnabled ? await ensureDavey() : 0,
      onAudioFrame: (frame) => advancePosition(player, frame),
      onGatewayClose: (code, reason, byRemote) => {
        sendGuildOp(player.guildId, {
          op: 'event',
          type: 'WebSocketClosedEvent',
          guildId: player.guildId,
          code,
          reason,
          byRemote
        })
      }
    })
  } catch (error) {
    logger.warn(
      { err: error, guildId: player.guildId },
      'Voice connect failed, player keeps stored voice state.'
    )
    player.connection = null
    return
  }
  if (session.players.get(player.guildId) !== player) {
    // Deleted or replaced mid-handshake: destroy, don't orphan the live
    // heartbeat, sockets and DAVE session on a detached player.
    player.connection?.[Symbol.dispose]()
    player.connection = null
    return
  }
  // The track may have landed while the handshake was in flight, in which
  // case the PATCH-time syncPlayback saw no live connection and bailed.
  // Syncing here closes that window from the other side.
  await syncPlayback(player, config, logger)
  sendGuildOp(player.guildId, {
    op: 'playerUpdate',
    guildId: player.guildId,
    state: playerStateSnapshot(player)
  })
}
