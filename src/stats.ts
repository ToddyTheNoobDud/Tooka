/* Node telemetry for the stats op and GET /v4/stats. Field shapes follows
  the documented ll v4 api (here: https://lavalink.dev/api/rest.html#get-lavalink-stats). */

import { cpus, freemem, loadavg, totalmem } from 'node:os'
import { allSessions } from './players/sessions'

export interface FrameStatsSnapshot {
  sent: number
  nulled: number
  deficit: number
}

export interface NodeStats {
  players: number
  playingPlayers: number
  uptime: number
  memory: {
    free: number
    used: number
    allocated: number
    reservable: number
  }
  cpu: {
    cores: number
    systemLoad: number
    tookaLoad: number
  }
  frameStats: FrameStatsSnapshot | null
}

const bootTime = Date.now()
let lastCpuUsage = process.cpuUsage()
let lastCpuAt = Date.now()

export function collectNodeStats(): NodeStats {
  let players = 0
  let playingPlayers = 0
  let sent = 0
  let nulled = 0
  let deficit = 0
  for (const session of allSessions()) {
    for (const player of session.players.values()) {
      players += 1
      if (player.track && !player.paused) playingPlayers += 1
      const stats = player.connection?.stats()
      if (stats) {
        sent += stats.packetsSent
        nulled += stats.framesDropped
        deficit += stats.expectedFrames - stats.packetsSent
      }
    }
  }
  const now = Date.now()
  const cpu = process.cpuUsage(lastCpuUsage)
  const wallMs = Math.max(now - lastCpuAt, 1)
  lastCpuUsage = process.cpuUsage()
  lastCpuAt = now
  const cores = cpus().length || 1
  const memory = process.memoryUsage()
  return {
    players,
    playingPlayers,
    uptime: now - bootTime,
    memory: {
      free: freemem(),
      used: memory.heapUsed,
      allocated: memory.heapTotal,
      reservable: totalmem()
    },
    cpu: {
      cores,
      systemLoad: Math.min((loadavg()[0] as number) / cores, 1),
      tookaLoad: Math.min((cpu.user + cpu.system) / 1000 / wallMs / cores, 1)
    },
    frameStats: players === 0 ? null : { sent, nulled, deficit }
  }
}
