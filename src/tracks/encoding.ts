import type { EncodeTrackInput } from '../types/utils'
import {
  fieldSize,
  nullableSize,
  prepareNullable,
  prepareString,
  trackFlags,
  writeLong,
  writeNullable,
  writePrepared
} from './shared'

export function encodeTrack(track: EncodeTrackInput): string {
  if (!track || typeof track !== 'object') {
    throw new Error('Encode Error: track must be an object')
  }
  for (const field of [
    'title',
    'author',
    'identifier',
    'sourceName'
  ] as const) {
    if (typeof track[field] !== 'string') {
      throw new Error(`Encode Error: ${field} must be a string`)
    }
  }
  if (!Number.isFinite(track.length)) {
    throw new Error('Encode Error: length must be a finite number')
  }

  const version = track.artworkUrl || track.isrc ? 3 : track.uri ? 2 : 1

  const title = prepareString(track.title)
  const author = prepareString(track.author)
  const identifier = prepareString(track.identifier)
  const sourceName = prepareString(track.sourceName)
  const uri = version >= 2 ? prepareNullable(track.uri) : null
  const artworkUrl = version >= 3 ? prepareNullable(track.artworkUrl) : null
  const isrc = version >= 3 ? prepareNullable(track.isrc) : null

  const messageLength =
    1 +
    fieldSize(title) +
    fieldSize(author) +
    8 +
    fieldSize(identifier) +
    1 +
    nullableSize(uri) +
    nullableSize(artworkUrl) +
    nullableSize(isrc) +
    fieldSize(sourceName) +
    8

  const buffer = Buffer.alloc(4 + messageLength)
  let offset = 4

  buffer[offset++] = version
  offset = writePrepared(buffer, offset, title, track.title)
  offset = writePrepared(buffer, offset, author, track.author)
  offset = writeLong(buffer, offset, track.length)
  offset = writePrepared(buffer, offset, identifier, track.identifier)
  buffer[offset++] = track.isStream ? 1 : 0
  if (version >= 2) offset = writeNullable(buffer, offset, uri, track.uri)
  if (version >= 3) {
    offset = writeNullable(buffer, offset, artworkUrl, track.artworkUrl)
    offset = writeNullable(buffer, offset, isrc, track.isrc)
  }
  offset = writePrepared(buffer, offset, sourceName, track.sourceName)
  writeLong(buffer, offset, track.position ?? 0)

  buffer.writeInt32BE(
    (messageLength & 0x3fffffff) | ((trackFlags & 3) << 30),
    0
  )
  // ecma 2026+  btw.
  return buffer.toBase64()
}
