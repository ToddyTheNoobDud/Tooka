import { describe, expect, test } from 'bun:test'
import { deepMergeDefaults } from '../../src/managers/configmanager'

describe('deepMergeDefaults', () => {
  test('fills nested gaps, user wins, reports paths', () => {
    const { merged, added } = deepMergeDefaults(
      { a: 1, nested: { x: 1, y: 2 }, list: [1] },
      { nested: { y: 99 }, extra: true }
    )
    expect(merged).toEqual({
      a: 1,
      nested: { x: 1, y: 99 },
      list: [1],
      extra: true
    })
    expect(added.sort()).toEqual(['a', 'list', 'nested.x'])
  })

  test('arrays are replaced, not merged', () => {
    const { merged } = deepMergeDefaults({ list: [1, 2] }, { list: [3] })
    expect(merged).toEqual({ list: [3] })
  })

  test('no gaps, no additions', () => {
    const { merged, added } = deepMergeDefaults({ a: 1 }, { a: 2 })
    expect(merged).toEqual({ a: 2 })
    expect(added).toEqual([])
  })
})
