/* Shared 20ms packet ticker. One timer for all voice connections. Due order
  comes from a min-heap on nextDue, so register/update/fire stay O(log n)
  no matter how many guilds are connected. */

export interface TickSource {
  tick(now: number): number | null
}

interface Entry {
  owner: object
  source: TickSource
  nextDue: number
}

export interface SchedulerStats {
  sources: number
  maxLateness: number
  ticks: number
}

const MAX_LATENESS_MS = 100

class Scheduler {
  private readonly heap: Entry[] = []
  private readonly positions = new Map<object, number>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private maxLateness = 0
  private ticks = 0

  public get size(): number {
    return this.heap.length
  }

  public register(
    owner: object,
    source: TickSource,
    nextDue: number
  ): Disposable {
    const at = this.positions.get(owner)
    if (at !== undefined) {
      const entry = this.heap[at] as Entry
      entry.source = source
      entry.nextDue = nextDue
      this.sift(at)
    } else {
      this.push({ owner, source, nextDue })
    }
    this.rearm()
    return {
      [Symbol.dispose]: () => this.unregister(owner)
    }
  }

  public update(owner: object, nextDue: number): void {
    const at = this.positions.get(owner)
    if (at === undefined) return
    ;(this.heap[at] as Entry).nextDue = nextDue
    this.sift(at)
    this.rearm()
  }

  public unregister(owner: object): void {
    const at = this.positions.get(owner)
    if (at === undefined) return
    this.removeAt(at)
    this.rearm()
  }

  public stats(): SchedulerStats {
    return {
      sources: this.heap.length,
      maxLateness: this.maxLateness,
      ticks: this.ticks
    }
  }

  public reset(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.heap.length = 0
    this.positions.clear()
    this.maxLateness = 0
    this.ticks = 0
  }

  private push(entry: Entry): void {
    this.heap.push(entry)
    this.positions.set(entry.owner, this.heap.length - 1)
    this.siftUp(this.heap.length - 1)
  }

  private popTop(): Entry {
    const top = this.heap[0] as Entry
    const last = this.heap.pop() as Entry
    this.positions.delete(top.owner)
    if (this.heap.length > 0) {
      this.heap[0] = last
      this.positions.set(last.owner, 0)
      this.siftDown(0)
    }
    return top
  }

  private removeAt(at: number): void {
    const removed = this.heap[at] as Entry
    const last = this.heap.pop() as Entry
    this.positions.delete(removed.owner)
    if (at < this.heap.length) {
      this.heap[at] = last
      this.positions.set(last.owner, at)
      this.sift(at)
    }
  }

  private swap(left: number, right: number): void {
    const heap = this.heap
    const leftEntry = heap[left] as Entry
    const rightEntry = heap[right] as Entry
    heap[left] = rightEntry
    heap[right] = leftEntry
    this.positions.set(rightEntry.owner, left)
    this.positions.set(leftEntry.owner, right)
  }

  private siftUp(at: number): void {
    while (at > 0) {
      const parent = (at - 1) >> 1
      if (
        (this.heap[parent] as Entry).nextDue <= (this.heap[at] as Entry).nextDue
      )
        break
      this.swap(parent, at)
      at = parent
    }
  }

  private siftDown(at: number): void {
    for (;;) {
      const left = at * 2 + 1
      const right = left + 1
      let smallest = at
      if (
        left < this.heap.length &&
        (this.heap[left] as Entry).nextDue <
          (this.heap[smallest] as Entry).nextDue
      ) {
        smallest = left
      }
      if (
        right < this.heap.length &&
        (this.heap[right] as Entry).nextDue <
          (this.heap[smallest] as Entry).nextDue
      ) {
        smallest = right
      }
      if (smallest === at) break
      this.swap(at, smallest)
      at = smallest
    }
  }

  private sift(at: number): void {
    this.siftUp(at)
    this.siftDown(at)
  }

  private rearm(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.heap.length === 0) return
    const delay = Math.max(
      0,
      (this.heap[0] as Entry).nextDue - performance.now()
    )
    this.timer = setTimeout(() => this.fire(), delay)
    this.timer.unref?.()
  }

  private fire(): void {
    this.timer = null
    this.ticks += 1
    const now = performance.now()
    while (this.heap.length > 0) {
      const top = this.heap[0] as Entry
      const lateness = now - top.nextDue
      if (lateness > this.maxLateness) this.maxLateness = lateness
      // Heap order means the first non-due entry ends the sweep: everything
      // behind it is due even later.
      if (top.nextDue > now) break
      this.popTop()
      if (lateness > MAX_LATENESS_MS) top.nextDue = now
      const next = top.source.tick(now)
      if (next === null) continue
      top.nextDue = next
      this.push(top)
    }
    this.rearm()
  }
}

export const voiceScheduler = new Scheduler()
