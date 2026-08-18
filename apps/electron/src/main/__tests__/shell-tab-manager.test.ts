import { describe, expect, it } from 'bun:test'
import { BUILT_IN_APPS } from '../../shared/app-platform'
import { ShellTabManager } from '../shell-tab-manager'

function createManager(initialActiveTarget: 'home' | 'agent' = 'home') {
  return new ShellTabManager({ initialActiveTarget, panelWidthPx: 560 })
}

function openTodo(manager: ShellTabManager, id = 'todo-1') {
  return manager.openAppTab({
    definition: BUILT_IN_APPS.TODO_PLACEHOLDER,
    tabId: id,
    webContentsId: -1,
  }).value.tab
}

describe('ShellTabManager 原子事务', () => {
  it('创建 singleton app，重复打开只激活现有 tab', () => {
    const manager = createManager()
    const first = manager.openAppTab({
      definition: BUILT_IN_APPS.TODO_PLACEHOLDER,
      tabId: 'todo-1',
      webContentsId: -1,
    }).value
    const second = manager.openAppTab({
      definition: BUILT_IN_APPS.TODO_PLACEHOLDER,
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
    snapshot.tabs.push({ id: 'bad', appId: 'bad', title: 'bad', webContentsId: -9 })
    expect(manager.getState().tabs).toEqual([])

    const opened = manager.openAppTab({
      definition: BUILT_IN_APPS.TODO_PLACEHOLDER,
      tabId: 'todo-1',
      webContentsId: -1,
    }).value
    opened.tab.title = 'mutated'
    expect(manager.getState().tabs[0].title).toBe('TODO')
  })
})
