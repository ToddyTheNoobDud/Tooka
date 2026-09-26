import { describe, expect, test } from 'bun:test'
import { voiceScheduler } from '../../src/voice/scheduler'

describe('voice scheduler', () => {
  test('fires overdue sources and drops them on null', async () => {
    voiceScheduler.reset()
    let calls = 0
    voiceScheduler.register(
      {},
      {
        tick: () => {
          calls += 1
          return null
        }
      },
      performance.now() - 20
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls).toBe(1)
    expect(voiceScheduler.size).toBe(0)
  })

  test('keeps sources that return a next due', async () => {
    voiceScheduler.reset()
    const owner = {}
    voiceScheduler.register(
      owner,
      { tick: () => performance.now() + 10_000 },
      performance.now() - 5
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(voiceScheduler.size).toBe(1)
    expect(voiceScheduler.stats().ticks).toBeGreaterThan(0)
    voiceScheduler.unregister(owner)
    expect(voiceScheduler.size).toBe(0)
  })

  test('unregisters source automatically via using', () => {
    voiceScheduler.reset()
    const owner = {}
    {
      using _reg = voiceScheduler.register(
        owner,
        { tick: () => performance.now() + 10_000 },
        performance.now() + 5000
      )
      expect(voiceScheduler.size).toBe(1)
    }
    expect(voiceScheduler.size).toBe(0)
  })
})
