import type pino from 'pino'
import { allSessions, playerStateSnapshot } from '../players/sessions'
import type { ConfigProps } from '../types/config'

// Periodic guild notifications: playerUpdate snapshots for clients, plus
// stuck detection (pumping but no audio out for longer than threshold).
export function startPlayerSweep(
  config: ConfigProps,
  logger: pino.Logger
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    const now = Date.now()
    for (const session of allSessions()) {
      if (!session.ws) continue
      for (const player of session.players.values()) {
        if (!player.track) continue
        try {
          session.ws.send(
            JSON.stringify({
              op: 'playerUpdate',
              guildId: player.guildId,
              state: playerStateSnapshot(player)
            })
          )
        } catch {
          // closed socket, expiry will reap it
        }
        // Playing, connected and pumping, but no audio has come out for
        // longer than the stuck threshold: the transcoder is wedged.
        if (
          player.track &&
          !player.paused &&
          player.playback !== null &&
          player.connection?.state === 'connected' &&
          player.lastAudioAt > 0 &&
          !player.stuckNotified &&
          now - player.lastAudioAt > config.player.stuckThresholdMs
        ) {
          player.stuckNotified = true
          try {
            session.ws.send(
              JSON.stringify({
                op: 'event',
                type: 'TrackStuckEvent',
                guildId: player.guildId,
                track: player.track,
                thresholdMs: config.player.stuckThresholdMs
              })
            )
          } catch {
            // closed socket, expiry will reap it
          }
          logger.warn(
            `Player ${player.guildId} stuck: no audio for ${config.player.stuckThresholdMs}ms.`
          )
        }
      }
    }
  }, config.player.updateIntervalMs)
  timer.unref?.()
  return timer
}
