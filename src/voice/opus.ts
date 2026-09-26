/* Opus constants and packet helpers. 48kHz stereo, 20ms frames. */

export const OPUS_SAMPLE_RATE = 48000
export const OPUS_FRAME_DURATION_MS = 20
export const OPUS_FRAME_SAMPLES =
  (OPUS_SAMPLE_RATE * OPUS_FRAME_DURATION_MS) / 1000
export const OPUS_TIMESTAMP_INCREMENT = OPUS_FRAME_SAMPLES
export const OPUS_MAX_PACKET_SAMPLES = 5760

export const OPUS_SILENCE_FRAME = new Uint8Array([0xf8, 0xff, 0xfe])

export function isSilenceFrame(frame: Uint8Array): boolean {
  return (
    frame.length === 3 &&
    frame[0] === 0xf8 &&
    frame[1] === 0xff &&
    frame[2] === 0xfe
  )
}

// Frame durations in ms per TOC config id (RFC 6716 section 3.1).
const tocDurations: number[] = [
  10, 20, 40, 60, 10, 20, 40, 60, 10, 20, 40, 60, 10, 20, 10, 20, 2.5, 5, 10,
  20, 2.5, 5, 10, 20, 2.5, 5, 10, 20, 2.5, 5, 10, 20
]

export function opusPacketSamples(packet: Uint8Array): number {
  if (packet.length === 0) return 0
  const toc = packet[0] as number
  const config = toc >> 3
  const frameCountCode = toc & 3
  const duration = tocDurations[config] as number
  let frames = 1
  if (frameCountCode === 3) {
    if (packet.length < 2) return 0
    frames = (packet[1] as number) & 63
  } else if (frameCountCode !== 0) {
    frames = 2
  }
  return Math.min(
    frames * duration * (OPUS_SAMPLE_RATE / 1000),
    OPUS_MAX_PACKET_SAMPLES
  )
}
