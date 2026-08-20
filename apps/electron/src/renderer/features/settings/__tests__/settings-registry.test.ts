import { describe, expect, it } from 'bun:test'
import { VALID_SETTINGS_SUBPAGES } from '../../../../shared/settings-registry'
import { SETTINGS_PAGES } from '../settings-registry'

describe('Settings page registry', () => {
  it('registers every shared Settings page exactly once', () => {
    const ids = SETTINGS_PAGES.map(page => page.id)
    expect(ids).toEqual([...VALID_SETTINGS_SUBPAGES])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has stable ordering and lazy components', () => {
    const orders = SETTINGS_PAGES.map(page => page.order)
    expect(orders).toEqual([...orders].sort((left, right) => left - right))
    expect(SETTINGS_PAGES.every(page => page.component != null)).toBe(true)
  })
})
