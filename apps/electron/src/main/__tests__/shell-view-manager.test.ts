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
mock.module('../browser-cdp', () => ({
  BrowserCDP: class MockBrowserCDP {
    getAccessibilitySnapshot = mock(async () => ({
      url: 'hxsy-app://todo-placeholder/index.html',
      title: 'TODO',
      nodes: [{ ref: '@e1', role: 'button', name: '创建' }],
    }))
    clickElement = mock(async (ref: string) => ({ ref, box: { x: 1, y: 2, width: 30, height: 20 }, clickPoint: { x: 16, y: 12 } }))
    clickAtCoordinates = mock(async () => {})
    fillElement = mock(async (ref: string) => ({ ref, box: { x: 1, y: 2, width: 30, height: 20 }, clickPoint: { x: 16, y: 12 } }))
    typeText = mock(async () => {})
    selectOption = mock(async (ref: string) => ({ ref, box: { x: 1, y: 2, width: 30, height: 20 }, clickPoint: { x: 16, y: 12 } }))
    getElementGeometry = mock(async (ref: string) => ({ ref, box: { x: 1, y: 2, width: 30, height: 20 }, clickPoint: ref === '@e1' ? { x: 16, y: 12 } : { x: 80, y: 90 } }))
    drag = mock(async () => {})
    detach = mock(() => {})
  },
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
    webTools: [{
      name: 'create_todo',
      description: '创建一个待办事项',
      handler: 'createTodo',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
        additionalProperties: false,
      },
    }],
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
    send: mock((..._args: unknown[]) => {}),
    executeJavaScript: mock(async (expression: string) => {
      if (expression.includes('outerHTML')) return { html: '<main><button>创建</button></main>', truncated: false, totalCharacters: 35 }
      if (expression.includes('innerText')) return { text: '创建', truncated: false, totalCharacters: 2 }
      if (expression.includes('window.scrollBy')) return { scrollX: 0, scrollY: 500 }
      if (expression.includes('__hxsyAppBrowserOk')) {
        if (expression.includes('boom')) {
          return { __hxsyAppBrowserOk: false, error: 'boom', stack: 'Error: boom\n at app.js:1' }
        }
        return { __hxsyAppBrowserOk: true, value: { evaluated: true } }
      }
      return { evaluated: expression }
    }),
    getTitle: () => 'TODO',
    isLoading: () => false,
    canGoBack: () => false,
    canGoForward: () => false,
    sendInputEvent: mock(() => {}),
    goBack: mock(() => {}),
    goForward: mock(() => {}),
    reload: mock(() => {}),
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

  it('routes a manifest-declared WebTool to its registered app handler and returns the result', async () => {
    const manager = new ShellViewManager({
      window: createWindow() as any,
      workspaceId: 'ws-1',
      initialActiveTarget: 'home',
      externalAppRegistry: createExternalAppRegistry() as any,
      registerSurface: () => {},
      unregisterSurface: () => {},
    })

    const opened = manager.openApp('todo-placeholder')
    expect(opened.status).toBe('opened')
    const tab = manager.getState().tabs[0]
    const guest = createGuest(40, tab.entry)
    expect(manager.attachGuest(guest as any)).toBe(true)
    manager.handleWebToolRegistered(40, 'createTodo')

    const resultPromise = manager.callWebTool('todo-placeholder', 'create_todo', { title: 'Ship it' })
    await Promise.resolve()
    const invocation = guest.send.mock.calls.find(call =>
      call[0] === 'app-platform:external-web-tool-invoke'
    )?.[1] as { callId: string; handler: string; arguments: Record<string, unknown> }
    expect(invocation).toMatchObject({
      handler: 'createTodo',
      arguments: { title: 'Ship it' },
    })

    manager.handleWebToolResult(40, {
      callId: invocation.callId,
      ok: true,
      result: { item: { title: 'Ship it' }, totalCount: 1 },
    })
    await expect(resultPromise).resolves.toEqual({ item: { title: 'Ship it' }, totalCount: 1 })

    expect(manager.closeApp('todo-placeholder')).toMatchObject({ status: 'closed', tabId: tab.id })
    expect(guest.close).toHaveBeenCalled()
  })

  it('rejects undeclared WebTools and arguments that violate manifest inputSchema', async () => {
    const manager = new ShellViewManager({
      window: createWindow() as any,
      workspaceId: 'ws-1',
      initialActiveTarget: 'home',
      externalAppRegistry: createExternalAppRegistry() as any,
      registerSurface: () => {},
      unregisterSurface: () => {},
    })
    manager.openApp('todo-placeholder')

    await expect(manager.callWebTool('todo-placeholder', 'delete_everything', {}))
      .rejects.toThrow('does not expose WebTool')
    await expect(manager.callWebTool('todo-placeholder', 'create_todo', { extra: true }))
      .rejects.toThrow('arguments.title is required')
    await expect(manager.callWebTool('todo-placeholder', 'create_todo', { title: 123 }))
      .rejects.toThrow('arguments.title must be a string')

    manager.destroy()
  })

  it('rejects a waiting WebTool call when the app closes before handler registration', async () => {
    const manager = new ShellViewManager({
      window: createWindow() as any,
      workspaceId: 'ws-1',
      initialActiveTarget: 'home',
      externalAppRegistry: createExternalAppRegistry() as any,
      registerSurface: () => {},
      unregisterSurface: () => {},
    })
    manager.openApp('todo-placeholder')
    const tab = manager.getState().tabs[0]
    expect(manager.attachGuest(createGuest(41, tab.entry) as any)).toBe(true)

    const resultPromise = manager.callWebTool('todo-placeholder', 'create_todo', { title: 'Never created' })
    const rejection: Promise<Error> = resultPromise.then(
      () => new Error('Expected WebTool call to reject'),
      error => error as Error,
    )
    await Promise.resolve()
    expect((manager as any).webToolRegistrationWaiters.size).toBe(1)
    expect([...(manager as any).webToolRegistrationWaiters.values()][0].size).toBe(1)
    expect(manager.closeApp('todo-placeholder').status).toBe('closed')
    expect((manager as any).webToolRegistrationWaiters.size).toBe(0)
    expect((await rejection).message).toContain('App closed before WebTool registered')
  })

  it('inspects and simulates interaction inside an App WebView with snapshot refs', async () => {
    const manager = new ShellViewManager({
      window: createWindow() as any,
      workspaceId: 'ws-1',
      initialActiveTarget: 'home',
      externalAppRegistry: createExternalAppRegistry() as any,
      registerSurface: () => {},
      unregisterSurface: () => {},
    })
    manager.openApp('todo-placeholder')
    const tab = manager.getState().tabs[0]
    const guest = createGuest(42, tab.entry)
    expect(manager.attachGuest(guest as any)).toBe(true)

    expect(await manager.appBrowser('todo-placeholder', 'source')).toMatchObject({
      command: 'source',
      result: { html: expect.stringContaining('<button>') },
    })
    expect(await manager.appBrowser('todo-placeholder', 'snapshot')).toMatchObject({
      command: 'snapshot',
      result: { nodes: [{ ref: '@e1', role: 'button', name: '创建' }] },
    })
    expect(await manager.appBrowser('todo-placeholder', ['click', '@e1'])).toMatchObject({ command: 'click' })
    expect(await manager.appBrowser('todo-placeholder', ['fill', '@e1', '发布桌面端'])).toMatchObject({ command: 'fill' })
    expect(await manager.appBrowser('todo-placeholder', ['scroll', 'down', '500'])).toMatchObject({
      result: { scrollY: 500 },
    })
    expect(await manager.appBrowser('todo-placeholder', ['drag', '@e1', '@e2'])).toMatchObject({ command: 'drag' })
    expect(await manager.appBrowser('todo-placeholder', ['key', 'Enter', 'meta'])).toMatchObject({ command: 'key' })
    expect(guest.sendInputEvent).toHaveBeenCalledTimes(2)

    expect(await manager.appBrowser('todo-placeholder', '[evaluate, ({a: 1, b: 2})]')).toMatchObject({
      command: 'evaluate',
      result: { evaluated: true },
    })
    expect(await manager.appBrowser(
      'todo-placeholder',
      'evaluate document.getElementById("todo-title").value',
    )).toMatchObject({ command: 'evaluate', result: { evaluated: true } })
    const evaluateScript = guest.executeJavaScript.mock.calls.at(-1)?.[0] as string
    expect(evaluateScript).toContain('getElementById(\\"todo-title\\")')
    expect(evaluateScript).not.toContain('getElementById(todo-title)')
    await expect(manager.appBrowser(
      'todo-placeholder',
      '["evaluate", "(() => { throw new Error(\\"boom\\") })()"]',
    )).rejects.toThrow('Renderer evaluate failed: boom')
  })

  it('uses explicit Agent focus and queues commands/intents until renderer is ready', () => {
    const window = createWindow()
    const manager = new ShellViewManager({
      window: window as any,
      workspaceId: 'ws-1',
      initialActiveTarget: 'home',
      externalAppRegistry: createExternalAppRegistry() as any,
      registerSurface: () => {},
      unregisterSurface: () => {},
    })

    manager.toggleAgentPanel()
    expect(manager.getState().agentPanelVisible).toBe(true)
    expect(() => manager.markAgentRendererReady(window.webContents.id)).not.toThrow()
    expect(window.webContents.send).toHaveBeenCalledWith(
      'app-platform:agent-presentation-changed',
      expect.objectContaining({ presentation: 'panel' })
    )
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

    manager.dockAgentAsPanel({ type: 'conversation', sessionId: 'session-2' })
    expect(window.webContents.send).toHaveBeenCalledWith(
      'app-platform:agent-navigation-intent-received',
      { type: 'conversation', sessionId: 'session-2' }
    )

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

  it('hosts built-in browser as a multi-instance tab without privileged preload', () => {
    const attached: Array<{ instanceId: string; contents: any; host: any }> = []
    const detached: Array<{ instanceId: string; webContentsId: number }> = []
    const browserTabs = {
      createManualBrowser: mock(() => 'browser-manual'),
      attachTabWebContents: mock((instanceId: string, contents: any, host: any) => {
        attached.push({ instanceId, contents, host })
      }),
      detachTabWebContents: mock((instanceId: string, webContentsId: number) => {
        detached.push({ instanceId, webContentsId })
      }),
      setTabVisibility: mock(() => {}),
    }
    const manager = new ShellViewManager({
      window: createWindow() as any,
      workspaceId: 'ws-1',
      initialActiveTarget: 'home',
      externalAppRegistry: createExternalAppRegistry() as any,
      registerSurface: () => {},
      unregisterSurface: () => {},
      browserTabs,
    })

    const opened = manager.openBrowserTab('browser-1', { show: true })
    const tab = manager.getState().tabs.find(candidate => candidate.id === opened.tabId)!
    expect(tab).toMatchObject({ kind: 'browser', appId: 'browser', browserInstanceId: 'browser-1' })
    const background = manager.openBrowserTab('browser-2', { show: false })
    expect(manager.getState().activeTarget).toEqual({ kind: 'app', tabId: tab.id })
    expect(manager.getState().tabs).toHaveLength(2)
    expect(manager.getState().tabs.find(candidate => candidate.id === background.tabId)?.entry)
      .not.toBe(tab.entry)

    const preferences: Record<string, unknown> = { preload: '/should/be/removed.cjs' }
    expect(manager.authorizeGuest(tab.entry, preferences as any, tab.partition)).toBe(true)
    expect(preferences).toMatchObject({
      partition: 'persist:browser-pane',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    })
    expect(preferences.additionalArguments).toContain('--hxsy-browser-instance-id=browser-1')
    expect(preferences.preload).toBeUndefined()

    // Chromium may report an empty URL during did-attach-webview. It must not
    // consume another tab's pending descriptor by FIFO guess.
    expect(manager.attachGuest(createGuest(59, '') as any)).toBe(false)

    const guest = createGuest(60, tab.entry)
    expect(manager.attachGuest(guest as any)).toBe(true)
    expect(guest.setWindowOpenHandler).not.toHaveBeenCalled()
    expect(attached).toHaveLength(1)
    expect(attached[0]).toMatchObject({ instanceId: 'browser-1', contents: guest })

    attached[0].host.update({
      id: 'browser-1',
      url: 'https://example.com/',
      title: 'Example',
      favicon: null,
      isLoading: false,
      canGoBack: true,
      canGoForward: false,
      boundSessionId: null,
      ownerType: 'manual',
      ownerSessionId: null,
      isVisible: true,
      workspaceId: 'ws-1',
    }, 'Agent — testing')
    expect(manager.getState().tabs[0]).toMatchObject({
      title: 'Example',
      entry: expect.stringContaining('browser-empty-state.html'),
      browserState: { canGoBack: true, agentControlLabel: 'Agent — testing' },
    })

    manager.closeTab(tab.id)
    expect(detached).toContainEqual({ instanceId: 'browser-1', webContentsId: 60 })
    expect(guest.close).toHaveBeenCalled()
    manager.closeTab(background.tabId)
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
    const window = createWindow()
    const manager = new ShellViewManager({
      window: window as any,
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
    expect(manager.getState().workspaceId).toBe('ws-2')
    expect(window.webContents.send).toHaveBeenCalledWith(
      'app-platform:state-changed',
      expect.objectContaining({ workspaceId: 'ws-2' }),
    )
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
