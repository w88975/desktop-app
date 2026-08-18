import { describe, expect, it, mock } from 'bun:test'

mock.module('electron', () => ({
  shell: { openExternal: mock(async () => {}) },
}))
mock.module('../logger', () => ({
  windowLog: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) },
}))

const { ShellViewManager } = await import('../shell-view-manager')

function createWindow() {
  const listeners = new Map<string, Function[]>()
  return {
    webContents: {
      id: 1,
      isDestroyed: () => false,
      send: mock(() => {}),
    },
    getContentSize: () => [1400, 900],
    isDestroyed: () => false,
    on: (event: string, callback: Function) => listeners.set(event, [...(listeners.get(event) ?? []), callback]),
    removeListener: mock(() => {}),
  }
}

function createGuest(id: number, url: string) {
  const listeners = new Map<string, Function[]>()
  let destroyed = false
  const emit = (event: string, ...args: unknown[]) => {
    for (const callback of listeners.get(event) ?? []) callback(...args)
  }
  return {
    id,
    mainFrame: {},
    getURL: () => url,
    getOSProcessId: () => 1000 + id,
    isDestroyed: () => destroyed,
    setWindowOpenHandler: mock(() => {}),
    emit,
    on: (event: string, callback: Function) => listeners.set(event, [...(listeners.get(event) ?? []), callback]),
    once: (event: string, callback: Function) => listeners.set(event, [...(listeners.get(event) ?? []), callback]),
    send: mock(() => {}),
    close: mock(() => {
      if (destroyed) return
      destroyed = true
      emit('destroyed')
    }),
  }
}

function addQuery(base: string, params: Record<string, string>): string {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

describe('ShellViewManager webview lifecycle', () => {
  it('registers persistent Home/Agent guests and enforces singleton app tabs', () => {
    const registered: Array<{ id: number; kind: string; tabId?: string }> = []
    const unregistered: number[] = []
    const manager = new ShellViewManager({
      window: createWindow() as any,
      workspaceId: 'ws-1',
      initialActiveTarget: 'home',
      registerSurface: (id, kind, tabId) => registered.push({ id, kind, tabId }),
      unregisterSurface: id => unregistered.push(id),
    })
    const bootstrap = manager.getWebviewBootstrap()

    expect(manager.attachGuest(createGuest(10, addQuery(bootstrap.appHostSrc, { appId: 'home' })) as any)).toBe(true)
    expect(manager.attachGuest(createGuest(11, bootstrap.agentSrc) as any)).toBe(true)
    expect(registered.map(item => item.kind)).toEqual(['home', 'agent'])

    manager.openApp('todo-placeholder')
    const first = manager.getState().tabs[0]
    manager.openApp('todo-placeholder')
    expect(manager.getState().tabs).toHaveLength(1)
    expect(manager.getState().activeTarget).toEqual({ kind: 'app', tabId: first.id })

    const appGuest = createGuest(12, addQuery(bootstrap.appHostSrc, {
      appId: 'todo-placeholder',
      tabId: first.id,
    }))
    expect(manager.attachGuest(appGuest as any)).toBe(true)
    expect(manager.getState().tabs[0].webContentsId).toBe(12)

    manager.closeTab(first.id)
    expect(manager.getState()).toMatchObject({ activeTarget: { kind: 'home' }, tabs: [] })
    expect(appGuest.close).toHaveBeenCalled()
    expect(unregistered).toContain(12)

    manager.openApp('todo-placeholder')
    expect(manager.getState().tabs[0].id).not.toBe(first.id)
  })

  it('uses explicit Agent focus and queues commands/intents until renderer is ready', () => {
    const manager = new ShellViewManager({
      window: createWindow() as any,
      workspaceId: 'ws-1',
      initialActiveTarget: 'home',
      registerSurface: () => {},
      unregisterSurface: () => {},
    })

    manager.toggleAgentPanel()
    expect(manager.getState().agentPanelVisible).toBe(true)
    manager.focusAgentTab({ type: 'conversation', sessionId: 'session-1' })
    expect(manager.getState()).toMatchObject({
      activeTarget: { kind: 'agent' },
      agentPanelVisible: false,
    })

    manager.sendAgentCommand('open-settings')
    const agent = createGuest(20, manager.getWebviewBootstrap().agentSrc)
    expect(manager.attachGuest(agent as any)).toBe(true)
    expect(agent.send).not.toHaveBeenCalledWith('app-platform:agent-command-received', 'open-settings')

    manager.markAgentRendererReady(20)
    expect(agent.send).toHaveBeenCalledWith(
      'app-platform:agent-navigation-intent-received',
      { type: 'conversation', sessionId: 'session-1' }
    )
    expect(agent.send).toHaveBeenCalledWith('app-platform:agent-command-received', 'open-settings')

    manager.sendAgentCommand('open-shortcuts')
    expect(agent.send).toHaveBeenCalledWith('app-platform:agent-command-received', 'open-shortcuts')

    agent.emit('did-start-navigation')
    manager.sendAgentCommand('new-session')
    expect(agent.send).not.toHaveBeenCalledWith('app-platform:agent-command-received', 'new-session')
    manager.markAgentRendererReady(20)
    expect(agent.send).toHaveBeenCalledWith('app-platform:agent-command-received', 'new-session')
  })

  it('unfocuses Full Agent when Home or an app tab is activated', () => {
    const manager = new ShellViewManager({
      window: createWindow() as any,
      workspaceId: 'ws-1',
      initialActiveTarget: 'agent',
      registerSurface: () => {},
      unregisterSurface: () => {},
    })

    manager.activateHome()
    expect(manager.getState()).toMatchObject({
      activeTarget: { kind: 'home' },
      agentPanelVisible: false,
    })

    manager.openApp('todo-placeholder')
    const tabId = manager.getState().tabs[0].id
    manager.focusAgentTab()
    expect(manager.getState().activeTarget).toEqual({ kind: 'agent' })

    manager.activateTab(tabId)
    expect(manager.getState()).toMatchObject({
      activeTarget: { kind: 'app', tabId },
      agentPanelVisible: false,
    })
  })
})
