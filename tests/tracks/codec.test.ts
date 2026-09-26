import { describe, expect, test } from 'bun:test'
import { decodeTrack } from '../../src/tracks/decoding'
import { encodeTrack } from '../../src/tracks/encoding'
import type { EncodeTrackInput } from '../../src/types/utils'

function input(overrides: Partial<EncodeTrackInput> = {}): EncodeTrackInput {
  return {
    identifier: 'soundcloud:tracks:1',
    author: 'author',
    length: 1000,
    isStream: false,
    title: 'title',
    sourceName: 'soundcloud',
    ...overrides
  }
}

describe('track codec round-trip', () => {
  test('v1 without optionals', () => {
    const track = input()
    const decoded = decodeTrack(encodeTrack(track))
    expect(decoded.info).toMatchObject({
      identifier: track.identifier,
      author: track.author,
      length: track.length,
      isStream: false,
      title: track.title,
      uri: null,
      artworkUrl: null,
      isrc: null,
      sourceName: track.sourceName,
      position: 0,
      isSeekable: true
    })
  })

  test('v2/v3 optionals survive', () => {
    const track = input({
      uri: 'https://example.com/x',
      artworkUrl: 'https://example.com/a.png',
      isrc: 'ABC123',
      position: 42,
      isStream: true
    })
    const decoded = decodeTrack(encodeTrack(track))
    expect(decoded.info.uri).toBe(track.uri ?? null)
    expect(decoded.info.artworkUrl).toBe(track.artworkUrl ?? null)
    expect(decoded.info.isrc).toBe(track.isrc ?? null)
    expect(decoded.info.position).toBe(42)
    expect(decoded.info.isSeekable).toBe(false)
  })

  test('modified utf-8 (emoji, NUL) round-trips', () => {
    const track = input({ title: 'a\0b 🎵 c', author: 'd\0e' })
    const decoded = decodeTrack(encodeTrack(track))
    expect(decoded.info.title).toBe(track.title)
    expect(decoded.info.author).toBe(track.author)
  })

  test('rejects garbage', () => {
    expect(() => decodeTrack('')).toThrow()
    expect(() => decodeTrack('AAAA')).toThrow()
    const full = encodeTrack(input())
    expect(() => decodeTrack(full.slice(0, full.length - 4))).toThrow()
  })
})
