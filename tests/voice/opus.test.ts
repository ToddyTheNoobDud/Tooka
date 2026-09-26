import { describe, expect, test } from 'bun:test'
import { isSilenceFrame, opusPacketSamples } from '../../src/voice/opus'

describe('opus helpers', () => {
  test('silence frame', () => {
    expect(isSilenceFrame(new Uint8Array([0xf8, 0xff, 0xfe]))).toBe(true)
    expect(isSilenceFrame(new Uint8Array([0xf8, 0xff]))).toBe(false)
    expect(isSilenceFrame(new Uint8Array([0x00]))).toBe(false)
  })

  test('packet durations from TOC byte', () => {
    expect(opusPacketSamples(new Uint8Array([]))).toBe(0)
    // config 0, 1 frame x 10ms
    expect(opusPacketSamples(new Uint8Array([0x00]))).toBe(480)
    // silence TOC: config 31 -> 20ms x 1 frame
    expect(opusPacketSamples(new Uint8Array([0xf8, 0xff, 0xfe]))).toBe(960)
    // frame count code 3 with count byte 5: 5 frames x 20ms
    expect(opusPacketSamples(new Uint8Array([0xfb, 0x05]))).toBe(4800)
  })
})
