import type { AppDefinition, InstalledAppSummary } from '../shared/app-platform'

export const SETTINGS_APP_ID = 'settings'

export function createSettingsDefinition(
  entry: string,
  status: AppDefinition['status'] = 'loading',
): AppDefinition {
  return {
    id: SETTINGS_APP_ID,
    title: '设置',
    entry,
    kind: 'internal',
    instancePolicy: 'single',
    capabilities: ['settings'],
    status,
  }
}

export function getInternalInstalledApps(): InstalledAppSummary[] {
  return [{
    appId: SETTINGS_APP_ID,
    kind: 'internal',
    status: 'ready',
    title: '设置',
    description: '管理应用与 Agent 设置',
    webTools: [],
  }]
}
