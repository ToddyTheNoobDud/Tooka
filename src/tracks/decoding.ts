import type { Track } from '../types/utils'
import { readByte, readNullableText, readUtf8 } from './shared'

export function decodeTrack(encoded: string): Track {
  if (!encoded) throw new Error('Decode Error: input is empty')
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.length < 4) throw new Error('Decode Error: buffer too short')
  const messageSize = buffer.readInt32BE(0) & 0x3fffffff
  if (messageSize === 0 || buffer.length < 4 + messageSize) {
    throw new Error('Decode Error: truncated message')
  }
  const message = buffer.subarray(4, 4 + messageSize)
  if (message.length < 8) throw new Error('Decode Error: truncated message')

  const cursor = { offset: 0 }
  const version = readByte(message, cursor)
  const title = readUtf8(message, cursor)
  const author = readUtf8(message, cursor)
  if (cursor.offset + 8 > message.length) {
    throw new Error('Decode Error: truncated message')
  }
  const length = Number(message.readBigInt64BE(cursor.offset))
  cursor.offset += 8
  const identifier = readUtf8(message, cursor)
  const isStream = readByte(message, cursor) !== 0
  const uri = version >= 2 ? readNullableText(message, cursor) : null
  const artworkUrl = version >= 3 ? readNullableText(message, cursor) : null
  const isrc = version >= 3 ? readNullableText(message, cursor) : null
  const sourceName = readUtf8(message, cursor)
  const position = Number(message.readBigInt64BE(message.length - 8))

  return {
    encoded,
    info: {
      identifier,
      author,
      length,
      isStream,
      title,
      uri,
      artworkUrl,
      isrc,
      sourceName,
      position,
      isSeekable: !isStream
    },
    pluginInfo: {},
    userData: {}
  }
}
