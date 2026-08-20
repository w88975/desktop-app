import { describe, expect, it } from 'bun:test'
import { isSettingsShortcut } from '../settings-shortcut'

const input = (overrides: Partial<Electron.Input> = {}): Electron.Input => ({
  type: 'keyDown',
  key: ',',
  code: 'Comma',
  isAutoRepeat: false,
  isComposing: false,
  shift: false,
  control: false,
  alt: false,
  meta: false,
  location: 0,
  modifiers: [],
  ...overrides,
} as Electron.Input)

describe('Settings shortcut', () => {
  it('accepts Command+, on macOS', () => {
    expect(isSettingsShortcut(input({ meta: true }), 'darwin')).toBe(true)
    expect(isSettingsShortcut(input({ control: true }), 'darwin')).toBe(false)
  })

  it('accepts Control+, on Windows and Linux', () => {
    expect(isSettingsShortcut(input({ control: true }), 'win32')).toBe(true)
    expect(isSettingsShortcut(input({ control: true }), 'linux')).toBe(true)
  })

  it('rejects key-up and extra modifiers', () => {
    expect(isSettingsShortcut(input({ meta: true, type: 'keyUp' }), 'darwin')).toBe(false)
    expect(isSettingsShortcut(input({ meta: true, shift: true }), 'darwin')).toBe(false)
    expect(isSettingsShortcut(input({ meta: true, control: true }), 'darwin')).toBe(false)
    expect(isSettingsShortcut(input({ control: true, alt: true }), 'win32')).toBe(false)
  })
})
