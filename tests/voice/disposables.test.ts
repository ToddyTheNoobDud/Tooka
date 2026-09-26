import { describe, expect, test } from 'bun:test'
import type pino from 'pino'
import { Player } from '../../src/players/player'
import { type DaveCallbacks, DaveSession } from '../../src/voice/dave'

describe('explicit resource management disposables', () => {
  test('DaveSession implements Disposable', () => {
    let destroyed = false
    const session = new DaveSession(
      'user',
      'channel',
      null as unknown as pino.Logger,
      {} as DaveCallbacks
    )
    session.destroy = () => {
      destroyed = true
    }

    {
      using _scoped = session
      expect(destroyed).toBe(false)
    }

    expect(destroyed).toBe(true)
  })

  test('Player implements Disposable', () => {
    let destroyed = false
    const player = new Player('guild-123')
    player.destroy = () => {
      destroyed = true
    }

    {
      using _scoped = player
      expect(destroyed).toBe(false)
    }

    expect(destroyed).toBe(true)
  })
})
