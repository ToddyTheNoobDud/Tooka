/* Playback pump: matches the ffmpeg stream to player state. */

import type pino from 'pino'
import type { Player } from '../players/player'
import { sendGuildOp, trackEventOp } from '../players/sessions'
import { resolveTrackStream } from '../sources/index'
import type { ConfigProps } from '../types/config'
import type { VoiceConnection } from './connection'
import { ffmpegOpusFrames } from './ffmpeg'
import { OPUS_SAMPLE_RATE, opusPacketSamples } from './opus'
import { FrameQueue } from './queue'

// Frames buffered before the stream goes audible (~1s). ffmpeg needs
// 1-3s to fetch HLS + warm up libopus; starting consumption at zero sends
// silence-then-trickle and receivers answer with PLC + huge jitter buffers.
const PREBUFFER_FRAMES = 50

export function stopPlayback(player: Player): void {
  player.playback?.[Symbol.dispose]()
  player.playback = null
  try {
    player.connection?.attachFrames(null)
  } catch {
    // connection already gone
  }
}

// Single teardown path for a dead pump: drop the queue, detach only from
// the connection that owns it, clear the track, emit one event.
function releaseTrack(
  player: Player,
  connection: VoiceConnection | null,
  event: Record<string, unknown> | null
): void {
  player.playback = null
  if (connection && player.connection === connection) {
    try {
      connection.attachFrames(null)
    } catch {
      // connection already gone
    }
  }
  player.setTrack(null)
  if (event) sendGuildOp(player.guildId, event)
}

export function advancePosition(player: Player, frame: Uint8Array): void {
  player.lastAudioAt = Date.now()
  player.stuckNotified = false
  player.setPosition(
    player.position +
      Math.round((opusPacketSamples(frame) * 1000) / OPUS_SAMPLE_RATE)
  )
  if (player.endTime !== null && player.position >= player.endTime) {
    const ended = player.track
    stopPlayback(player)
    player.setTrack(null)
    if (ended) {
      sendGuildOp(
        player.guildId,
        trackEventOp('TrackEndEvent', player.guildId, ended, 'stopped')
      )
    }
  }
}

// Starts, restarts, or stops the ffmpeg pump so it matches player state.
// Same track still playing: pump keeps running. Anything else restarts.
export async function syncPlayback(
  player: Player,
  config: ConfigProps,
  logger: pino.Logger
): Promise<void> {
  const key = player.track && !player.paused ? player.track.encoded : null
  if (player.playback?.key === key) {
    // Same pump still authoritative: re-attach to whichever connection is
    // current (a reconnect may have swapped it since the pump started).
    const current = player.connection
    if (
      current &&
      current.state === 'connected' &&
      key !== null &&
      player.playback
    ) {
      current.attachFrames(player.playback.queue)
    }
    return
  }
  const connection = player.connection
  const live = connection !== null && connection.state === 'connected'
  stopPlayback(player)
  if (key === null || !live || !player.track) return
  const uri = player.track.info.uri
  if (!uri) {
    logger.warn(`Player ${player.guildId} track has no uri, cannot play audio.`)
    const failed = player.track
    // Only clear what we checked: a concurrent PATCH may have replaced it.
    if (failed?.encoded === key) {
      player.setTrack(null)
      sendGuildOp(
        player.guildId,
        trackEventOp('TrackEndEvent', player.guildId, failed, 'loadFailed')
      )
    }
    return
  }
  const stream = await resolveTrackStream(player.track, { config, logger })
  if (player.track?.encoded !== key || player.paused) return
  if (!stream) {
    logger.warn(`Player ${player.guildId} has no playable stream.`)
    const failed = player.track
    player.setTrack(null)
    if (failed) {
      sendGuildOp(
        player.guildId,
        trackEventOp('TrackEndEvent', player.guildId, failed, 'loadFailed')
      )
    }
    return
  }
  if (player.playback?.key === key) {
    const current = player.connection
    if (current && current.state === 'connected') {
      current.attachFrames(player.playback.queue)
    }
    return
  }
  // Same staleness window as above: resolve awaited network while a voice
  // PATCH reconnected. If the connection moved on (or the track did), bail
  // out - the fresh connection's own sync owns playback from here.
  const liveConnection = player.connection
  if (
    liveConnection === null ||
    liveConnection.state !== 'connected' ||
    liveConnection !== connection ||
    player.track?.encoded !== key ||
    !player.track
  ) {
    return
  }
  // 100-frame (~2s) jitter buffer: Ogg pages arrive in ~50-frame bursts
  // roughly once a second, a smaller cap would drop half of every burst.
  const queue = new FrameQueue(100)
  let stopped = false
  let attached = false
  let pumpDone = false
  const stop = (): void => {
    stopped = true
    queue.clear()
  }
  player.playback = {
    key,
    queue,
    stop,
    [Symbol.dispose]: stop
  }
  // Fresh timestamp: lastAudioAt still holds the previous track's final
  // frame, which would read as stuck-now. The sweep judges from here.
  player.lastAudioAt = Date.now()
  player.stuckNotified = false
  // The stream goes audible only once buffered: attaching an empty queue
  // sends silence-then-trickle while ffmpeg warms up, and receivers answer
  // with PLC + a blown-up jitter buffer. EOF with anything buffered still
  // attaches, so very short tracks play instead of being dropped.
  const maybeAttach = (): void => {
    if (attached || stopped || player.playback?.queue !== queue) return
    if (player.connection !== liveConnection) return
    if (queue.size < PREBUFFER_FRAMES && !pumpDone) return
    if (queue.size === 0) return
    attached = true
    liveConnection.attachFrames(queue)
    logger.info(`Playback started for guild ${player.guildId}.`)
    const startedTrack = player.track
    if (startedTrack) {
      sendGuildOp(
        player.guildId,
        trackEventOp('TrackStartEvent', player.guildId, startedTrack)
      )
    }
  }
  // Background pump: syncPlayback returns immediately so PATCH responds in
  // ms with the track still set. The loop ends the track when ffmpeg EOFs.
  void (async () => {
    try {
      for await (const frame of ffmpegOpusFrames(stream.url, {
        logger,
        bitrate: config.audio.bitrate,
        startAtMs: player.position,
        volume: player.volume / 100
      })) {
        if (stopped || player.playback?.queue !== queue) break
        queue.push(frame)
        maybeAttach()
      }
    } catch (error) {
      logger.warn(
        { err: error, guildId: player.guildId },
        'Audio pump failed, stopping track.'
      )
      if (!stopped && player.playback?.queue === queue) {
        const failed = player.track
        if (!failed) {
          releaseTrack(player, liveConnection, null)
          return
        }
        if (attached) {
          const cause = Error.isError(error)
            ? error
            : new Error('Audio pump failed.')
          releaseTrack(player, liveConnection, {
            op: 'event',
            type: 'TrackExceptionEvent',
            guildId: player.guildId,
            track: failed,
            exception: {
              message: cause.message.slice(0, 300),
              severity: 'common',
              cause: 'ffmpeg',
              causeStackTrace: (cause.stack ?? cause.message).slice(0, 500)
            }
          })
        } else {
          releaseTrack(
            player,
            liveConnection,
            trackEventOp('TrackEndEvent', player.guildId, failed, 'loadFailed')
          )
        }
        return
      }
    }
    if (!stopped && player.playback?.queue === queue) {
      // EOF: attach any remainder (very short track, or a stalled pump)
      // instead of dropping it, then finish as usual.
      pumpDone = true
      maybeAttach()
      const finishedTrack = player.track
      logger.info(`Playback finished for guild ${player.guildId}.`)
      releaseTrack(
        player,
        liveConnection,
        finishedTrack
          ? trackEventOp(
              'TrackEndEvent',
              player.guildId,
              finishedTrack,
              'finished'
            )
          : null
      )
    }
  })()
}
