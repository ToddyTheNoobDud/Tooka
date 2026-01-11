import pino, { type Logger as PinoLogger } from 'pino'

type LogFn = (msg: string, obj?: Record<string, unknown>) => void

export type AppLogger = {
  error: LogFn
  warn: LogFn
  info: LogFn
  debug: LogFn
  trace: LogFn
  fatal: LogFn
}

const base: PinoLogger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname'
    }
  }
})

const wrap =
  (fn: (obj: object, msg?: string) => void): LogFn =>
  (msg, obj) => {
    if (obj) fn(obj, msg)
    else (fn as unknown as (msg: string) => void)(msg)
  }

export const logger: AppLogger = {
  error: wrap(base.error.bind(base)),
  warn: wrap(base.warn.bind(base)),
  info: wrap(base.info.bind(base)),
  debug: wrap(base.debug.bind(base)),
  trace: wrap(base.trace.bind(base)),
  fatal: wrap(base.fatal.bind(base))
}

export function getVersion(mode: 'object' | 'string' = 'string') {
  const v = {
    name: 'tooka',
    major: 0,
    minor: 0,
    patch: 1
  }

  if (mode === 'object') return v
  return `${v.major}.${v.minor}.${v.patch}`
}
