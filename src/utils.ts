import pino, { type Logger as PinoLogger } from 'pino'
import type { TrackInfo } from './types'

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


function decodeTrack(encoded: string) {
  if (!encoded) throw new Error('Decode Error: Input string is null or empty')

  const buffer = Buffer.from(encoded, 'base64')
  let position = 0

  const ensure = (n: number) => {
    if (position + n > buffer.length) {
      throw new Error(`Unexpected end of buffer at position ${position}, need ${n} bytes`)
    }
  }

  const read = {
    byte: () => {
      ensure(1)
      return buffer[position++]
    },
    int: () => {
      ensure(4)
      const value = buffer.readInt32BE(position)
      position += 4
      return value
    },
    long: () => {
      ensure(8)
      const value = buffer.readBigInt64BE(position)
      position += 8
      return value
    },
    utf: () => {
      ensure(2)
      const length = buffer.readUInt16BE(position)
      position += 2
      ensure(length)
      const value = buffer.toString('utf8', position, position + length)
      position += length
      return value
    }
  }

  const readNullableText = () => {
    const present = read.byte() !== 0
    return present ? read.utf() : null
  }

  const firstInt = read.int()
  const isVersioned = ((firstInt & 0xc0000000) >> 30) & 1
  const messageSize = firstInt & 0x3fffffff

  const version = isVersioned ? read.byte() : 1

  const title = read.utf()
  const author = read.utf()
  const length = Number(read.long())
  const identifier = read.utf()
  const isStream = read.byte() !== 0

  const uri = version >= 2 ? readNullableText() : null
  const artworkUrl = version >= 3 ? readNullableText() : null
  const isrc = version >= 3 ? readNullableText() : null

  const sourceName = read.utf()

  const messageEnd = 4 + messageSize
  const positionOffset = messageEnd - 8

  let details: (string | null)[] = []
  let seekable: boolean | undefined = undefined

  if (position < positionOffset) {
    const detailsBuf = buffer.subarray(position, positionOffset)
    let p = 0

    while (p < detailsBuf.length) {
      const present = detailsBuf[p++]
      if (!present) {
        details.push(null)
        continue
      }

      if (p + 2 > detailsBuf.length) break
      const len = detailsBuf.readUInt16BE(p)
      p += 2

      if (p + len > detailsBuf.length) break
      details.push(detailsBuf.toString('utf8', p, p + len))
      p += len
    }

    while (details.length && details[details.length - 1] === null) {
      details.pop()
    }

    if (details.length) {
      const last = details[details.length - 1]
      if (last === '__seekable:0') {
        details = details.slice(0, -1)
        seekable = false
      } else if (last === '__seekable:1') {
        details = details.slice(0, -1)
        seekable = true
      }
    }
  }

  position = positionOffset
  const trackPosition = Number(read.long())

  return {
    encoded,
    info: {
      title,
      author,
      length,
      identifier,
      isSeekable: typeof seekable === 'boolean' ? seekable : !isStream,
      isStream,
      uri,
      artworkUrl,
      isrc,
      sourceName,
      position: trackPosition
    },
    details,
    pluginInfo: {},
    userData: {}
  }
}

export function buildTrack(track: Partial<TrackInfo>): TrackInfo {
  return {
    title: track.title || '',
    author: track.author || '',
    length: Number(track.length || 0),
    identifier: track.identifier || '',
    isSeekable: typeof track.isSeekable === 'boolean' ? track.isSeekable : true,
    isStream: Boolean(track.isStream),
    uri: track.uri,
    artworkUrl: track.artworkUrl,
    isrc: track.isrc,
    sourceName: track.sourceName || '',
    position: Number(track.position || 0)
  }
}

function encodeTrack(track: any) {
  if (!track || typeof track !== 'object') {
    throw new Error('Encode Error: Input track must be a valid object')
  }

  const bodyParts: Buffer[] = []

  function writeUTF(value: any) {
    const str = String(value || '')
    const strBuf = Buffer.from(str, 'utf8')
    if (strBuf.length > 65535) throw new Error('UTF string too long')
    const lenBuf = Buffer.alloc(2)
    lenBuf.writeUInt16BE(strBuf.length)
    bodyParts.push(lenBuf)
    bodyParts.push(strBuf)
  }

  function writeNullableText(value: any) {
    if (value === undefined || value === null || value === '') {
      bodyParts.push(Buffer.from([0]))
    } else {
      bodyParts.push(Buffer.from([1]))
      writeUTF(String(value))
    }
  }

  function writeByte(value: any) {
    bodyParts.push(Buffer.from([value & 0xff]))
  }

  function writeLong(value: any) {
    const buf = Buffer.alloc(8)
    buf.writeBigInt64BE(BigInt(value || 0))
    bodyParts.push(buf)
  }

  const version = 3
  writeByte(version)

  writeUTF(track.title || '')
  writeUTF(track.author || '')
  writeLong(track.length || 0)
  writeUTF(track.identifier || '')
  writeByte(track.isStream ? 1 : 0)

  writeNullableText(track.uri)
  writeNullableText(track.artworkUrl)
  writeNullableText(track.isrc)

  writeUTF(track.sourceName || '')

  const detailsOut = Array.isArray(track.details) ? [...track.details] : []

  const seekable = typeof track.isSeekable === 'boolean' ? track.isSeekable : !track.isStream
  if (seekable !== !track.isStream) {
    detailsOut.push(seekable ? '__seekable:1' : '__seekable:0')
  }

  for (const v of detailsOut) {
    writeNullableText(v)
  }

  writeLong(track.position || 0)

  const messageBody = Buffer.concat(bodyParts)
  const messageSize = messageBody.length

  const header = Buffer.alloc(4)
  header.writeInt32BE((1 << 30) | messageSize)

  return Buffer.concat([header, messageBody]).toString('base64')
}

export {
  decodeTrack,
  encodeTrack
}
