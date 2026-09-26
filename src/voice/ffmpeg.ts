/* ffmpeg Opus frame source: spawns ffmpeg, demuxes Ogg Opus from stdout,
  yields whole 20ms audio packets. Native encoder/decoder later. */

import type pino from 'pino'

let ffmpegBinary: string | null | undefined

export function ffmpegPath(): string | null {
  if (ffmpegBinary === undefined) ffmpegBinary = Bun.which('ffmpeg')
  return ffmpegBinary
}

export function ensureFfmpeg(): string {
  const binary = ffmpegPath()
  if (!binary) throw new Error('ffmpeg was not found in PATH.')
  return binary
}

export interface FfmpegOptions {
  logger: pino.Logger
  headers?: Record<string, string>
  bitrate?: string
  startAtMs?: number
}

interface OggState {
  carry: Buffer
  started: boolean
  pending: Buffer[]
  pendingLength: number
}

// Exported for unit tests; the pump is the only other caller.
export function createOggState(): OggState {
  return {
    carry: Buffer.alloc(0),
    started: false,
    pending: [],
    pendingLength: 0
  }
}

// First 8 bytes across the pending parts, for header magic. Short packets
// yield a shorter string and never match, same as the old slice check.
function peekMagic(parts: Buffer[]): string {
  const head = Buffer.allocUnsafe(8)
  let filled = 0
  for (const part of parts) {
    const take = Math.min(part.length, 8 - filled)
    part.copy(head, filled, 0, take)
    filled += take
    if (filled >= 8) break
  }
  return head.subarray(0, filled).toString('utf8')
}

// Completes the pending packet with a single concat: headers (OpusHead,
// OpusTags) are swallowed, everything else audio is emitted.
function flushPacket(state: OggState, complete: Buffer[]): void {
  const parts = state.pending
  const length = state.pendingLength
  state.pending = []
  state.pendingLength = 0
  if (length === 0) return
  const magic = peekMagic(parts)
  if (!state.started) {
    if (magic === 'OpusHead') state.started = true
    return
  }
  if (magic === 'OpusTags') return
  complete.push(Buffer.concat(parts, length))
}

// Feeds raw bytes, returns newly completed packets. Segments accumulate as
// views and concat exactly once per packet; headers (OpusHead, OpusTags)
// are skipped by magic, everything else is audio.
// Exported for unit tests; the pump is the only other caller.
export function pushOggBytes(state: OggState, chunk: Uint8Array): Buffer[] {
  state.carry = Buffer.concat([state.carry, Buffer.from(chunk)])
  const complete: Buffer[] = []
  const data = state.carry
  let offset = 0
  while (offset + 27 <= data.length) {
    if (
      data[offset] !== 0x4f ||
      data[offset + 1] !== 0x67 ||
      data[offset + 2] !== 0x67 ||
      data[offset + 3] !== 0x53
    ) {
      offset += 1
      continue
    }
    const segmentCount = data[offset + 26] as number
    if (offset + 27 + segmentCount > data.length) break
    let payloadSize = 0
    for (let i = 0; i < segmentCount; i++) {
      payloadSize += data[offset + 27 + i] as number
    }
    const pageEnd = offset + 27 + segmentCount + payloadSize
    if (pageEnd > data.length) break
    let position = offset + 27 + segmentCount
    for (let i = 0; i < segmentCount; i++) {
      const size = data[offset + 27 + i] as number
      if (size > 0) {
        state.pending.push(data.subarray(position, position + size))
        state.pendingLength += size
      }
      position += size
      if (size < 255) flushPacket(state, complete)
    }
    offset = pageEnd
  }
  state.carry = data.subarray(offset)
  return complete
}

export class FfmpegProcess implements AsyncDisposable {
  constructor(
    public readonly child: Bun.Subprocess,
    private readonly draining: Promise<void>
  ) {}

  public async [Symbol.asyncDispose](): Promise<void> {
    this.child.kill()
    await this.draining
    await this.child.exited
  }
}

export async function* ffmpegOpusFrames(
  url: string,
  options: FfmpegOptions
): AsyncGenerator<Uint8Array> {
  const binary = ensureFfmpeg()
  // -re paces output to real time: without it ffmpeg transcodes as fast as
  // possible, outruns the 20ms tick, and the bounded queue drops everything.
  const args = ['-v', 'error', '-nostdin', '-re']
  if (options.startAtMs !== undefined && options.startAtMs > 0) {
    args.push('-ss', (options.startAtMs / 1000).toString())
  }
  args.push(
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_delay_max',
    '5',
    '-i',
    url,
    '-map',
    'a:0',
    '-vn', // https://dev.to/kyle_clipspeedai/optimizing-ffmpeg-for-production-settings-that-cut-processing-time-by-40-4fhe, since we don't need the video stream js opus.
    '-c:a',
    'libopus',
    '-b:a',
    options.bitrate ?? '128k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-frame_duration',
    '20',
    '-f',
    'ogg',
    'pipe:1'
  )
  if (options.headers) {
    const lines = Object.entries(options.headers)
      .map(([key, value]) => `${key}: ${value}\r\n`)
      .join('')
    args.push('-headers', lines)
  }
  const child = Bun.spawn([binary, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore'
  })
  const state = createOggState()
  let stderrTail = ''
  const draining = (async () => {
    for await (const chunk of child.stderr) {
      stderrTail += Buffer.from(chunk).toString('utf8')
      if (stderrTail.length > 4096) {
        stderrTail = stderrTail.slice(stderrTail.length - 4096)
      }
    }
  })()
  {
    await using _ffmpegProcess = new FfmpegProcess(child, draining)
    for await (const chunk of child.stdout) {
      for (const packet of pushOggBytes(state, chunk)) {
        yield packet
      }
    }
  }
  if (child.exitCode !== 0 && child.exitCode !== null) {
    throw new Error(`ffmpeg exited with code ${child.exitCode}: ${stderrTail}`)
  }
}
