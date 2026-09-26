/* Bounded live-tail frame queue between the ffmpeg pump and the tick loop. */

export class FrameQueue {
  private readonly frames: Uint8Array[] = []
  private readonly capacity: number
  public dropped = 0

  constructor(capacity = 50) {
    this.capacity = capacity
  }

  public get size(): number {
    return this.frames.length
  }

  public push(frame: Uint8Array): void {
    if (this.frames.length >= this.capacity) {
      this.frames.shift()
      this.dropped += 1
    }
    this.frames.push(frame)
  }

  public shift(): Uint8Array | null {
    return this.frames.shift() ?? null
  }

  public clear(): void {
    this.frames.length = 0
  }
}
