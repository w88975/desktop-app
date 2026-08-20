import { describe, expect, it, mock } from 'bun:test'

const handleProtocol = mock(() => {})
const appSession = { protocol: { handle: handleProtocol } }
mock.module('electron', () => ({
  shell: { openExternal: mock(async () => {}) },
  session: {
    defaultSession: { protocol: { handle: mock(() => {}) } },
    fromPartition: mock(() => appSession),
  },
  protocol: { registerSchemesAsPrivileged: mock(() => {}) },
}))
mock.module('../logger', () => ({
  windowLog: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) },
}))

const { ShellViewManager } = await import('../shell-view-manager')

function createExternalAppRegistry() {
  const todo = {
    appId: 'todo-placeholder',
    sourceType: 'builtin',
    status: 'ready',
    title: 'TODO',
    description: '内置待办事项',
    iconUrl: 'hxsy-app://todo-placeholder/icon.svg',
    entryUrl: 'hxsy-app://todo-placeholder/index.html',
    webTools: [],
  }
  return {
    list: () => [structuredClone(todo)],
    get: (appId: string) => appId === todo.appId ? structuredClone(todo) : null,
    subscribe: () => () => {},
    retry: mock(async () => {}),
    resolveRemote: mock(async () => {}),
    markRuntimeError: mock(() => {}),
  }
}

function createRemoteAppRegistry() {
  let record: any = {
    appId: 'com.huaxisy.remote',
    sourceType: 'remote',
    status: 'discovered',
    title: '加载中...',
    webTools: [],
  }
  const listeners = new Set<(records: any[]) => void>()
  const emit = () => listeners.forEach(listener => listener([structuredClone(record)]))
  return {
    list: () => [structuredClone(record)],
    get: (appId: string) => appId === record.appId ? structuredClone(record) : null,
    subscribe: (listener: (records: any[]) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    retry: mock(async () => {}),
    resolveRemote: mock(async () => {
      record = {
        ...record,
        status: 'ready',
        title: 'Remote Demo',
        iconUrl: 'hxsy-app://com.huaxisy.remote/icon.svg',
        entryUrl: 'https://apps.internal/demo/',
      }
      emit()
      return structuredClone(record)
    }),
    markRuntimeError: mock((_appId: string, error: string) => {
      record = { ...record, status: 'error', title: '加载失败', error }
      emit()
    }),
  }
}

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
      externalAppRegistry: createExternalAppRegistry() as any,
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

    const preferences: Record<string, unknown> = {}
    expect(manager.authorizeGuest(first.entry, preferences as any, first.partition)).toBe(true)
    const appGuest = createGuest(12, first.entry)
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
      externalAppRegistry: createExternalAppRegistry() as any,
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

    manager.sendAgentCommand('toggle-sidebar')
    const agent = createGuest(20, manager.getWebviewBootstrap().agentSrc)
    expect(manager.attachGuest(agent as any)).toBe(true)
    expect(agent.send).not.toHaveBeenCalledWith('app-platform:agent-command-received', 'toggle-sidebar')

    manager.markAgentRendererReady(20)
    expect(agent.send).toHaveBeenCalledWith(
      'app-platform:agent-navigation-intent-received',
      { type: 'conversation', sessionId: 'session-1' }
    )
    expect(agent.send).toHaveBeenCalledWith('app-platform:agent-command-received', 'toggle-sidebar')

    manager.sendAgentCommand('new-session')
    expect(agent.send).toHaveBeenCalledWith('app-platform:agent-command-received', 'new-session')

    agent.send.mockClear()
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
      externalAppRegistry: createExternalAppRegistry() as any,
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

  it('opens one trusted Settings tab and remembers its last page', () => {
    const manager = new ShellViewManager({
      window: createWindow() as any,
      workspaceId: 'ws-1',
      initialActiveTarget: 'agent',
      externalAppRegistry: createExternalAppRegistry() as any,
      registerSurface: () => {},
      unregisterSurface: () => {},
    })

    expect(manager.getInstalledApps()[0]).toMatchObject({
      appId: 'settings',
      kind: 'internal',
      title: '设置',
    })

    manager.openSettings('appearance')
    const first = manager.getState().tabs[0]
    expect(first).toMatchObject({ appId: 'settings', kind: 'internal', status: 'loading' })
    expect(first.entry).toContain('#appearance')
    expect(manager.getState().activeTarget).toEqual({ kind: 'app', tabId: first.id })

    manager.openSettings('shortcuts')
    expect(manager.getState().tabs).toHaveLength(1)
    expect(manager.getState().tabs[0].entry).toContain('#shortcuts')

    const preferences: Record<string, unknown> = {}
    const currentEntry = manager.getState().tabs[0].entry
    expect(manager.authorizeGuest(currentEntry, preferences as any)).toBe(true)
    expect(String(preferences.preload)).toContain('settings-preload.cjs')

    const guest = createGuest(25, currentEntry)
    expect(manager.attachGuest(guest as any)).toBe(true)
    manager.markSettingsRendererReady(25)
    expect(manager.getState().tabs[0].status).toBe('ready')
    manager.openSettings('preferences')
    expect(guest.send).toHaveBeenCalledWith('app-platform:settings-navigate', 'preferences')

    manager.closeTab(first.id)
    manager.openSettings()
    expect(manager.getState().tabs[0].entry).toContain('#preferences')
  })

  it('updates Settings context when the Shell workspace changes', () => {
    const manager = new ShellViewManager({
      window: createWindow() as any,
      workspaceId: 'ws-1',
      initialActiveTarget: 'home',
      externalAppRegistry: createExternalAppRegistry() as any,
      registerSurface: () => {},
      unregisterSurface: () => {},
    })
    manager.openSettings()
    const tab = manager.getState().tabs[0]
    const guest = createGuest(26, tab.entry)
    expect(manager.attachGuest(guest as any)).toBe(true)

    manager.updateWorkspace('ws-2')
    expect(manager.getSettingsContext()).toEqual({ workspaceId: 'ws-2' })
    expect(guest.send).toHaveBeenCalledWith(
      'app-platform:settings-context-changed',
      { workspaceId: 'ws-2' },
    )
  })

  it('resolves Remote App lazily and authorizes its isolated webview', async () => {
    const registered: Array<{ id: number; kind: string; tabId?: string; appId?: string }> = []
    const registry = createRemoteAppRegistry()
    const manager = new ShellViewManager({
      window: createWindow() as any,
      workspaceId: 'ws-1',
      initialActiveTarget: 'home',
      externalAppRegistry: registry as any,
      registerSurface: (id, kind, tabId, appId) => registered.push({ id, kind, tabId, appId }),
      unregisterSurface: () => {},
    })

    manager.openApp('com.huaxisy.remote')
    await Promise.resolve()
    const tab = manager.getState().tabs[0]
    expect(tab).toMatchObject({
      appId: 'com.huaxisy.remote',
      kind: 'external',
      status: 'ready',
      title: 'Remote Demo',
      entry: 'https://apps.internal/demo/',
      partition: 'persist:hxsy-app-com.huaxisy.remote',
    })

    const preferences: Record<string, unknown> = {}
    expect(manager.authorizeGuest(tab.entry, preferences as any, tab.partition)).toBe(true)
    expect(String(preferences.preload)).toContain('external-app-preload.cjs')
    expect(preferences.partition).toBe(tab.partition)
    expect(handleProtocol).toHaveBeenCalledWith('hxsy-app', expect.any(Function))

    const guest = createGuest(30, tab.entry)
    expect(manager.attachGuest(guest as any)).toBe(true)
    expect(registered.at(-1)).toEqual({
      id: 30,
      kind: 'app',
      tabId: tab.id,
      appId: 'com.huaxisy.remote',
    })

    guest.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', tab.entry, true)
    expect(manager.getState().tabs[0]).toMatchObject({ status: 'error', title: '加载失败' })
  })
})
