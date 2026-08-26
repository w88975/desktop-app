import type { AppDefinition, ExternalAppRecord, InstalledAppSummary } from '../shared/app-platform'

export const SETTINGS_APP_ID = 'settings'
export const BROWSER_APP_ID = 'browser'

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
  }, {
    appId: BROWSER_APP_ID,
    kind: 'browser',
    status: 'ready',
    title: '浏览器',
    description: '内置浏览器，支持 Agent 自动化、登录态与开发者工具能力',
    webTools: [],
  }]
}

/** Single catalog projection shared by Home UI and agent prompt injection. */
export function buildInstalledAppSummaries(
  externalRecords: readonly ExternalAppRecord[],
): InstalledAppSummary[] {
  const externalApps = externalRecords.map(record => ({
    appId: record.appId,
    kind: record.sourceType === 'builtin' ? 'built-in' as const : 'external' as const,
    sourceType: record.sourceType,
    status: record.status,
    title: record.title,
    description: record.description,
    version: record.version,
    iconUrl: record.iconUrl,
    error: record.error,
    webTools: record.webTools,
  })).sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))

  return [...getInternalInstalledApps(), ...externalApps]
}
