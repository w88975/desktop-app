import type { MainAppTabActionResult, MainAppTabInfo, MainAppTabsResult } from '@craft-agent/session-tools-core'
import type { ShellState } from '../shared/app-platform'

export interface MainAppToolsHost {
  getState(): ShellState
  activateHome(): void
  focusAgentTab(): void
  activateTab(tabId: string): void
  closeTab(tabId: string): void
}

function activeTarget(state: ShellState): string {
  if (state.activeTarget.kind === 'home') return 'home'
  if (state.activeTarget.kind === 'agent') return 'agent'
  return state.activeTarget.tabId
}

export function listMainAppTabs(host: MainAppToolsHost): MainAppTabsResult {
  const state = host.getState()
  const active = activeTarget(state)
  const tabs: MainAppTabInfo[] = [
    {
      target: 'home',
      kind: 'home',
      title: 'Home',
      active: active === 'home',
      closable: false,
    },
    ...state.tabs.map(tab => ({
      target: tab.id,
      kind: 'app' as const,
      title: tab.title,
      active: active === tab.id,
      closable: true,
      tabId: tab.id,
      appId: tab.appId,
      status: tab.status,
    })),
    {
      target: 'agent',
      kind: 'agent',
      title: 'Agent',
      active: active === 'agent',
      closable: false,
    },
  ]
  return { activeTarget: active, tabs }
}

export function switchMainAppTab(host: MainAppToolsHost, target: string): MainAppTabActionResult {
  const normalized = target.trim()
  const before = listMainAppTabs(host)
  const tab = before.tabs.find(candidate => candidate.target === normalized)
  if (!tab) {
    throw new Error(`Unknown main App tab target: ${target}. Call main_app_list_tabs for current targets.`)
  }

  if (tab.kind === 'home') host.activateHome()
  else if (tab.kind === 'agent') host.focusAgentTab()
  else host.activateTab(tab.tabId!)

  return {
    action: 'switched',
    target: normalized,
    tab: { ...tab, active: true },
    state: listMainAppTabs(host),
  }
}

export function closeMainAppTab(host: MainAppToolsHost, target: string): MainAppTabActionResult {
  const normalized = target.trim()
  const before = listMainAppTabs(host)
  const tab = before.tabs.find(candidate => candidate.target === normalized)
  if (!tab) {
    throw new Error(`Unknown main App tab target: ${target}. Call main_app_list_tabs for current targets.`)
  }
  if (!tab.closable || tab.kind !== 'app' || !tab.tabId) {
    throw new Error(`${tab.title} is a persistent main App surface and cannot be closed.`)
  }

  host.closeTab(tab.tabId)
  return {
    action: 'closed',
    target: normalized,
    tab,
    state: listMainAppTabs(host),
  }
}
