import { describe, expect, test } from 'bun:test'
import {
  createOggState,
  FfmpegProcess,
  pushOggBytes
} from '../../src/voice/ffmpeg'

function oggPage(payload: Uint8Array, serial = 1, sequence = 0): Buffer {
  const header = Buffer.alloc(27)
  header.write('OggS', 0)
  header.writeUInt8(0, 4)
  header.writeUInt8(0, 5)
  header.writeBigUInt64LE(0n, 6)
  header.writeUInt32LE(serial, 14)
  header.writeUInt32LE(sequence, 18)
  header.writeUInt32LE(0, 22)
  // Single segment carrying the whole packet (lengths < 255 terminate it).
  const page = Buffer.concat([
    header.subarray(0, 26),
    Buffer.from([1]),
    Buffer.from([payload.length]),
    Buffer.from(payload)
  ])
  void sequence
  return page
}

function opusHead(): Buffer {
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0)
  return head
}

function opusTags(): Buffer {
  const tags = Buffer.alloc(18)
  tags.write('OpusTags', 0)
  return tags
}

describe('ogg demuxer', () => {
  test('skips headers, yields audio, survives splits', () => {
    const audio = Buffer.from(new Uint8Array([0xfc, 1, 2, 3, 4]))
    const stream = Buffer.concat([
      oggPage(opusHead(), 1, 0),
      oggPage(opusTags(), 1, 1),
      oggPage(audio, 1, 2)
    ])
    const state = createOggState()
    // Split mid-page: nothing complete yet.
    const first = pushOggBytes(state, stream.subarray(0, 40))
    expect(first).toEqual([])
    const rest = pushOggBytes(state, stream.subarray(40))
    expect(rest.length).toBe(1)
    expect(Buffer.from(rest[0] as Uint8Array).equals(audio)).toBe(true)
  })

  test('ignores non-ogg garbage', () => {
    const state = createOggState()
    expect(pushOggBytes(state, Buffer.from([1, 2, 3, 4]))).toEqual([])
  })
})

describe('FfmpegProcess', () => {
  test('disposes child process and awaits draining asynchronously via await using', async () => {
    let killed = false
    let drained = false
    let resolveDraining!: () => void
    const mockDraining = new Promise<void>((resolve) => {
      resolveDraining = () => {
        drained = true
        resolve()
      }
    })
    const mockChild = {
      kill: () => {
        killed = true
        resolveDraining()
      },
      exited: Promise.resolve(0)
    } as unknown as Bun.Subprocess

    {
      await using _proc = new FfmpegProcess(mockChild, mockDraining)
      expect(killed).toBe(false)
      expect(drained).toBe(false)
    }

    expect(killed).toBe(true)
    expect(drained).toBe(true)
  })
})
