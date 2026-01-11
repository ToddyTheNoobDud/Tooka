import type { TrackInfo, EncodedTrack } from '../types'

export interface SourceManager {
  name: string
  canHandle(url: string): boolean
  resolve(url: string): Promise<TrackInfo | TrackInfo[]>
  encode(track: TrackInfo): string
  decode(encoded: string): EncodedTrack
}

export class SourceManagerRegistry {
  private managers = new Map<string, SourceManager>()

  register(manager: SourceManager): void {
    this.managers.set(manager.name, manager)
  }

  get(name: string): SourceManager | undefined {
    return this.managers.get(name)
  }

  getAll(): SourceManager[] {
    return Array.from(this.managers.values())
  }

  keys(): string[] {
    return Array.from(this.managers.keys())
  }

  findManager(url: string): SourceManager | undefined {
    const values = this.managers.values()
    for (const manager of values) {
      if (manager.canHandle(url)) {
        return manager
      }
    }
    return undefined
  }

  async resolve(url: string): Promise<TrackInfo | TrackInfo[]> {
    const manager = this.findManager(url)
    if (!manager) {
      throw new Error(`No source manager found for URL: ${url}`)
    }
    return manager.resolve(url)
  }
}

export const sourceManagerRegistry = new SourceManagerRegistry()