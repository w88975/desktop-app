type ShortcutInput = Pick<Electron.Input, 'type' | 'key' | 'meta' | 'control' | 'alt' | 'shift'>

export function isSettingsShortcut(
  input: ShortcutInput | null | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!input || input.type !== 'keyDown' || input.key !== ',') return false
  const primaryModifier = platform === 'darwin' ? input.meta : input.control
  const secondaryPrimaryModifier = platform === 'darwin' ? input.control : input.meta
  return !!primaryModifier && !secondaryPrimaryModifier && !input.alt && !input.shift
}
