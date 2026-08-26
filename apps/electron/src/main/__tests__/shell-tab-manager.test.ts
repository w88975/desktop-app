import { describe, expect, it } from 'bun:test'
import type { AppDefinition } from '../../shared/app-platform'
import { ShellTabManager } from '../shell-tab-manager'

function createManager(initialActiveTarget: 'home' | 'agent' = 'home') {
  return new ShellTabManager({ initialActiveTarget, panelWidthPx: 560 })
}

const TEST_APP: AppDefinition = {
  id: 'todo-placeholder',
  title: 'TODO',
  entry: 'hxsy-app://todo-placeholder/index.html',
  kind: 'external',
  instancePolicy: 'single',
  capabilities: [],
  status: 'ready',
}

function openTodo(manager: ShellTabManager, id = 'todo-1') {
  return manager.openAppTab({
    definition: TEST_APP,
    tabId: id,
    webContentsId: -1,
  }).value.tab
}

describe('ShellTabManager 原子事务', () => {
  it('支持动态 Tab 拖拽重排', () => {
    const manager = createManager()
    const definition = { ...TEST_APP, instancePolicy: 'multiple' as const }
    for (const id of ['a', 'b', 'c']) {
      manager.openAppTab({ definition, tabId: id, webContentsId: -1 })
    }

    manager.reorderAppTab('c', 'a', 'before')
    expect(manager.getState().tabs.map(tab => tab.id)).toEqual(['c', 'a', 'b'])
    manager.reorderAppTab('c', 'b', 'after')
    expect(manager.getState().tabs.map(tab => tab.id)).toEqual(['a', 'b', 'c'])
  })

  it('创建 singleton app，重复打开只激活现有 tab', () => {
    const manager = createManager()
    const first = manager.openAppTab({
      definition: TEST_APP,
      tabId: 'todo-1',
      webContentsId: -1,
    }).value
    const second = manager.openAppTab({
      definition: TEST_APP,
      tabId: 'todo-2',
      webContentsId: -2,
    }).value

    expect(first.created).toBe(true)
    expect(second).toEqual({ tab: first.tab, created: false })
    expect(manager.getState().tabs).toEqual([first.tab])
    expect(manager.getState().activeTarget).toEqual({ kind: 'app', tabId: first.tab.id })
  })

  it('Panel、Full、unfocus、dock 遵守互斥状态', () => {
    const manager = createManager()
    const todo = openTodo(manager)

    manager.toggleAgentPanel()
    expect(manager.getState()).toMatchObject({
      activeTarget: { kind: 'app', tabId: todo.id },
      agentPanelVisible: true,
    })

    manager.focusAgentTab({ type: 'conversation', sessionId: 'session-1' })
    expect(manager.getState()).toMatchObject({
      activeTarget: { kind: 'agent' },
      agentPanelVisible: false,
      previousContentTabId: todo.id,
    })

    manager.unfocusAgentTab()
    expect(manager.getState()).toMatchObject({
      activeTarget: { kind: 'app', tabId: todo.id },
      agentPanelVisible: false,
    })

    manager.focusAgentTab()
    manager.dockAgentAsPanel()
    expect(manager.getState()).toMatchObject({
      activeTarget: { kind: 'app', tabId: todo.id },
      agentPanelVisible: true,
    })
  })

  it('全局 Agent 图标在 Full 时只 unfocus，不打开 Panel', () => {
    const manager = createManager('agent')
    manager.toggleAgentPanel()
    expect(manager.getState()).toMatchObject({
      activeTarget: { kind: 'home' },
      agentPanelVisible: false,
    })
  })

  it('External App bridge 可从 Full 幂等确保 Agent Panel 打开', () => {
    const manager = createManager()
    const todo = openTodo(manager)
    manager.focusAgentTab()
    manager.ensureAgentPanelVisible()
    expect(manager.getState()).toMatchObject({
      activeTarget: { kind: 'app', tabId: todo.id },
      agentPanelVisible: true,
    })
    manager.ensureAgentPanelVisible()
    expect(manager.getState().agentPanelVisible).toBe(true)
  })

  it('关闭 previous content 后回退最右 tab，再回 Home', () => {
    const manager = createManager()
    const todo = openTodo(manager)
    manager.focusAgentTab()
    const transaction = manager.closeAppTab(todo.id)

    expect(transaction.effects).toEqual([{ type: 'close-app-renderer', tab: todo }])
    expect(manager.getState()).toMatchObject({
      activeTarget: { kind: 'agent' },
      previousContentTabId: null,
      tabs: [],
    })

    manager.unfocusAgentTab()
    expect(manager.getState().activeTarget).toEqual({ kind: 'home' })
  })

  it('非法操作不提交部分状态', () => {
    const manager = createManager()
    const before = manager.getState()
    expect(() => manager.activateAppTab('missing')).toThrow('Unknown app tab: missing')
    expect(manager.getState()).toEqual(before)
    expect(() => manager.focusAgentTab({ type: 'conversation', sessionId: '  ' })).toThrow('Invalid Agent navigation intent')
    expect(manager.getState()).toEqual(before)
  })

  it('返回快照不能修改 manager 内部状态', () => {
    const manager = createManager()
    const snapshot = manager.getState()
    snapshot.tabs.push({
      id: 'bad',
      appId: 'bad',
      title: 'bad',
      webContentsId: -9,
      kind: 'external',
      entry: '',
      status: 'error',
    })
    expect(manager.getState().tabs).toEqual([])

    const opened = manager.openAppTab({
      definition: TEST_APP,
      tabId: 'todo-1',
      webContentsId: -1,
    }).value
    opened.tab.title = 'mutated'
    expect(manager.getState().tabs[0].title).toBe('TODO')
  })
})
