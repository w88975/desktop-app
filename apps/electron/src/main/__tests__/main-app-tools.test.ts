import { describe, expect, it } from 'bun:test'
import type { ShellState } from '../../shared/app-platform'
import {
  closeMainAppTab,
  listMainAppTabs,
  switchMainAppTab,
  type MainAppToolsHost,
} from '../main-app-tools'

function createHost(): MainAppToolsHost & { state: ShellState } {
  const host: MainAppToolsHost & { state: ShellState } = {
    state: {
      workspaceId: 'ws-1',
      activeTarget: { kind: 'agent' },
      tabs: [{
        id: 'tab-todo',
        appId: 'todo-placeholder',
        title: 'TODO',
        webContentsId: 42,
        kind: 'external',
        entry: 'hxsy-app://todo-placeholder/index.html',
        status: 'ready',
      }],
      agentPanelVisible: false,
      previousContentTabId: 'tab-todo',
      agentPanelWidthPx: 480,
    },
    getState: () => structuredClone(host.state),
    activateHome: () => { host.state.activeTarget = { kind: 'home' } },
    focusAgentTab: () => { host.state.activeTarget = { kind: 'agent' } },
    activateTab: tabId => { host.state.activeTarget = { kind: 'app', tabId } },
    closeTab: tabId => {
      host.state.tabs = host.state.tabs.filter(tab => tab.id !== tabId)
      if (host.state.activeTarget.kind === 'app' && host.state.activeTarget.tabId === tabId) {
        host.state.activeTarget = { kind: 'home' }
      }
    },
  }
  return host
}

describe('mainAppTools', () => {
  it('lists Home, open App tabs, and Agent with active/closable state', () => {
    const result = listMainAppTabs(createHost())
    expect(result.activeTarget).toBe('agent')
    expect(result.tabs).toEqual([
      expect.objectContaining({ target: 'home', kind: 'home', active: false, closable: false }),
      expect.objectContaining({
        target: 'tab-todo', kind: 'app', appId: 'todo-placeholder',
        tabId: 'tab-todo', active: false, closable: true, status: 'ready',
      }),
      expect.objectContaining({ target: 'agent', kind: 'agent', active: true, closable: false }),
    ])
  })

  it('switches Home, Agent, and App targets without recreating tabs', () => {
    const host = createHost()
    expect(switchMainAppTab(host, 'home').state.activeTarget).toBe('home')
    expect(switchMainAppTab(host, 'tab-todo').state.activeTarget).toBe('tab-todo')
    expect(switchMainAppTab(host, 'agent').state.activeTarget).toBe('agent')
    expect(host.state.tabs).toHaveLength(1)
  })

  it('closes App tabs and rejects persistent Home/Agent targets', () => {
    const host = createHost()
    const result = closeMainAppTab(host, 'tab-todo')
    expect(result).toMatchObject({ action: 'closed', target: 'tab-todo' })
    expect(result.state.tabs.map(tab => tab.target)).toEqual(['home', 'agent'])
    expect(() => closeMainAppTab(host, 'home')).toThrow('persistent main App surface')
    expect(() => closeMainAppTab(host, 'agent')).toThrow('persistent main App surface')
  })

  it('rejects stale or guessed tab IDs with discovery guidance', () => {
    expect(() => switchMainAppTab(createHost(), 'todo-placeholder')).toThrow('main_app_list_tabs')
  })
})
