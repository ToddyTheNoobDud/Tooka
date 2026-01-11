import type { AppLogger } from '../utils'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface CredentialCache {
  value: string
  expiresAt: number
}

interface CacheData {
  version: string
  lastUpdated: number
  credentials: Record<string, CredentialCache>
}

export class CredentialManager {
  private cache = new Map<string, CredentialCache>()
  private readonly defaultTTL = 6 * 60 * 60 * 1000
  private readonly cacheDir = path.join(process.cwd(), '.cache')
  private readonly cacheFile = path.join(this.cacheDir, 'credentials.json')
  private saveTimer: Timer | null = null
  private isDirty = false
  private loadPromise: Promise<void>

  constructor(private logger: AppLogger) {
    this.loadPromise = this.loadCache()
  }

  async waitForLoad(): Promise<void> {
    await this.loadPromise
  }

  get(key: string): string | null {
    const cached = this.cache.get(key)
    if (!cached) return null

    const now = Date.now()
    if (now >= cached.expiresAt) {
      this.cache.delete(key)
      this.isDirty = true
      this.scheduleSave()
      return null
    }

    return cached.value
  }

  getStats(): { total: number; valid: number; expired: number } {
    const now = Date.now()
    let valid = 0
    let expired = 0

    for (const cached of this.cache.values()) {
      if (now >= cached.expiresAt) {
        expired++
      } else {
        valid++
      }
    }

    return { total: this.cache.size, valid, expired }
  }

  private async loadCache(): Promise<void> {
    try {
      const cacheContent = await fs.readFile(this.cacheFile, 'utf8')
      const data: CacheData = JSON.parse(cacheContent)

      const now = Date.now()
      let loadedCount = 0
      let expiredCount = 0

      const entries = Object.entries(data.credentials)
      for (let i = 0; i < entries.length; i++) {
        const [key, cached] = entries[i]
        if (now < cached.expiresAt) {
          this.cache.set(key, cached)
          loadedCount++
        } else {
          expiredCount++
        }
      }

      if (loadedCount > 0) {
        this.logger.info('Loaded credentials from cache', {
          loaded: loadedCount,
          expired: expiredCount
        })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('Failed to load cache from file', { error })
      }
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      if (this.isDirty) {
        this.saveCache()
      }
    }, 1000)
  }

  private async saveCache(): Promise<void> {
    this.isDirty = false

    try {
      await fs.mkdir(this.cacheDir, { recursive: true })

      const credentials: Record<string, CredentialCache> = {}
      const entries = Array.from(this.cache.entries())
      for (let i = 0; i < entries.length; i++) {
        const [key, cached] = entries[i]
        credentials[key] = cached
      }

      const data: CacheData = {
        version: '1.0.0',
        lastUpdated: Date.now(),
        credentials
      }

      await fs.writeFile(this.cacheFile, JSON.stringify(data))
    } catch (error) {
      this.logger.error('Failed to save cache to file', { error })
    }
  }

  set(key: string, value: string, ttl: number = this.defaultTTL): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl
    })
    this.isDirty = true
    this.scheduleSave()
  }

  clear(key: string): void {
    this.cache.delete(key)
    this.isDirty = true
    this.scheduleSave()
  }

  clearAll(): void {
    this.cache.clear()
    this.isDirty = true
    this.scheduleSave()
  }

  async cleanup(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.isDirty) {
      await this.saveCache()
    }
  }
}