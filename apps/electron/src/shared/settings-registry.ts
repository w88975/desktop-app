/** Route-independent Settings identifiers shared with main/preload code. */
export const VALID_SETTINGS_SUBPAGES = [
  'app',
  'ai',
  'appearance',
  'input',
  'workspace',
  'permissions',
  'labels',
  'messaging',
  'server',
  'shortcuts',
  'preferences',
] as const

export type SettingsSubpage = (typeof VALID_SETTINGS_SUBPAGES)[number]

export function isValidSettingsSubpage(value: string): value is SettingsSubpage {
  return VALID_SETTINGS_SUBPAGES.includes(value as SettingsSubpage)
}
