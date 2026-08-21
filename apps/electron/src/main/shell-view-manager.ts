import { session, shell, type BrowserWindow, type WebContents, type WebPreferences } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { windowLog } from './logger'
import {
  APP_PLATFORM_CHANNELS,
  clampAgentPanelWidth,
  deriveAgentPresentationState,
  getDefaultAgentPanelWidth,
  type AgentNavigationIntent,
  type AgentShellCommand,
  type AppDefinition,
  type AppTab,
  type ExternalAppRecord,
  type ExternalWebToolResult,
  type InstalledAppSummary,
  type ShellState,
  type SurfaceKind,
  type WebviewSurfaceBootstrap,
} from '../shared/app-platform'
import { ShellTabManager, type ShellTabEffect } from './shell-tab-manager'
import type { ExternalAppRegistry } from './external-app-registry'
import { registerExternalAppProtocolForSession } from './external-app-protocol'
import { buildInstalledAppSummaries, createSettingsDefinition, SETTINGS_APP_ID } from './internal-app-registry'
import { isValidSettingsSubpage, type SettingsSubpage } from '../shared/settings-registry'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

interface ShellViewManagerOptions {
  window: BrowserWindow
  workspaceId: string
  initialActiveTarget?: 'home' | 'agent'
  externalAppRegistry: ExternalAppRegistry
  registerSurface: (webContentsId: number, kind: Exclude<SurfaceKind, 'shell'>, tabId?: string, appId?: string) => void
  unregisterSurface: (webContentsId: number) => void
}

interface ManagedTab {
  tab: AppTab
  definition: AppDefinition
  webContents: WebContents | null
}

interface PendingWebToolCall {
  webContentsId: number
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface WebToolRegistrationWaiter {
  resolve: (contents: WebContents) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface GuestDescriptor {
  kind: 'home' | 'agent' | 'app'
  tabId?: string
  appId?: string
  external?: boolean
  internal?: boolean
  preload: string
}

export class ShellViewManager {
  private readonly window: BrowserWindow
  private workspaceId: string
  private readonly registerSurface: ShellViewManagerOptions['registerSurface']
  private readonly unregisterSurface: ShellViewManagerOptions['unregisterSurface']
  private readonly externalAppRegistry: ExternalAppRegistry
  private readonly unsubscribeExternalApps: () => void
  private readonly managedTabs = new Map<string, ManagedTab>()
  private readonly registeredWebToolHandlers = new Map<number, Set<string>>()
  private readonly pendingWebToolCalls = new Map<string, PendingWebToolCall>()
  private readonly webToolRegistrationWaiters = new Map<string, Set<WebToolRegistrationWaiter>>()
  private readonly guestWebContents = new Map<number, WebContents>()
  private readonly pendingGuestDescriptors: GuestDescriptor[] = []
  private readonly queuedAgentCommands: AgentShellCommand[] = []
  private readonly queuedAgentNavigationIntents: AgentNavigationIntent[] = []
  private readonly tabManager: ShellTabManager
  private agentWebContents: WebContents | null = null
  private agentRendererReady = false
  private homeWebContents: WebContents | null = null
  private settingsWebContents: WebContents | null = null
  private lastSettingsSubpage: SettingsSubpage = 'app'
  private nextPendingWebContentsId = -1
  private destroyed = false

  constructor(options: ShellViewManagerOptions) {
    this.window = options.window
    this.workspaceId = options.workspaceId
    this.registerSurface = options.registerSurface
    this.unregisterSurface = options.unregisterSurface
    this.externalAppRegistry = options.externalAppRegistry

    const [width] = this.window.getContentSize()
    this.tabManager = new ShellTabManager({
      initialActiveTarget: options.initialActiveTarget ?? 'home',
      panelWidthPx: getDefaultAgentPanelWidth(width),
    })
    this.unsubscribeExternalApps = this.externalAppRegistry.subscribe(this.handleExternalAppsChanged)

    this.window.on('resize', this.handleResize)
  }

  getWebviewBootstrap(): WebviewSurfaceBootstrap {
    const bootstrapPreload = pathToFileURL(join(__dirname, 'bootstrap-preload.cjs')).toString()
    const appHostPreload = pathToFileURL(join(__dirname, 'app-host-preload.cjs')).toString()
    const settingsPreload = pathToFileURL(join(__dirname, 'settings-preload.cjs')).toString()
    const externalAppPreload = pathToFileURL(join(__dirname, 'external-app-preload.cjs')).toString()

    if (VITE_DEV_SERVER_URL) {
      const agent = new URL('/index.html', VITE_DEV_SERVER_URL)
      agent.searchParams.set('workspaceId', this.workspaceId)
      agent.searchParams.set('surface', 'agent')
      return {
        agentSrc: agent.toString(),
        agentPreload: bootstrapPreload,
        appHostSrc: new URL('/app-host.html', VITE_DEV_SERVER_URL).toString(),
        appHostPreload,
        settingsSrc: new URL('/settings.html', VITE_DEV_SERVER_URL).toString(),
        settingsPreload,
        externalAppPreload,
      }
    }

    const agent = pathToFileURL(join(__dirname, 'renderer/index.html'))
    agent.searchParams.set('workspaceId', this.workspaceId)
    agent.searchParams.set('surface', 'agent')
    return {
      agentSrc: agent.toString(),
      agentPreload: bootstrapPreload,
      appHostSrc: pathToFileURL(join(__dirname, 'renderer/app-host.html')).toString(),
      appHostPreload,
      settingsSrc: pathToFileURL(join(__dirname, 'renderer/settings.html')).toString(),
      settingsPreload,
      externalAppPreload,
    }
  }

  private describeGuest(url: string, partition?: string): GuestDescriptor | null {
    try {
      const parsed = new URL(url)
      const bootstrap = this.getWebviewBootstrap()
      const agentEntry = new URL(bootstrap.agentSrc)
      const appEntry = new URL(bootstrap.appHostSrc)
      const settingsEntry = new URL(bootstrap.settingsSrc)

      if (parsed.origin === settingsEntry.origin && parsed.pathname === settingsEntry.pathname) {
        const tabId = parsed.searchParams.get('tabId') ?? undefined
        const tab = tabId ? this.managedTabs.get(tabId) : undefined
        if (!tab || tab.definition.kind !== 'internal' || tab.definition.id !== SETTINGS_APP_ID) return null
        return {
          kind: 'app',
          tabId,
          appId: SETTINGS_APP_ID,
          internal: true,
          preload: bootstrap.settingsPreload,
        }
      }

      if (parsed.origin !== agentEntry.origin || parsed.pathname !== agentEntry.pathname) {
        if (parsed.origin !== appEntry.origin || parsed.pathname !== appEntry.pathname) {
          const external = [...this.managedTabs.values()].find(item =>
            item.definition.kind === 'external'
            && item.definition.status === 'ready'
            && item.definition.entry === url
            && (!partition || item.definition.partition === partition)
          )
          return external
            ? {
                kind: 'app',
                tabId: external.tab.id,
                appId: external.definition.id,
                external: true,
                preload: this.getWebviewBootstrap().externalAppPreload,
              }
            : null
        }
      }

      if (parsed.pathname === agentEntry.pathname && parsed.searchParams.get('surface') === 'agent') {
        if (parsed.searchParams.get('workspaceId') !== this.workspaceId) return null
        return { kind: 'agent', preload: bootstrap.agentPreload }
      }

      if (parsed.pathname !== appEntry.pathname) return null
      const appId = parsed.searchParams.get('appId')
      if (appId === 'home') return { kind: 'home', preload: bootstrap.appHostPreload }

      const tabId = parsed.searchParams.get('tabId') ?? undefined
      const tab = tabId ? this.managedTabs.get(tabId) : undefined
      if (!tab || tab.definition.kind !== 'built-in' || tab.definition.id !== appId) return null
      return { kind: 'app', tabId, appId: tab.definition.id, preload: bootstrap.appHostPreload }
    } catch {
      return null
    }
  }

  authorizeGuest(url: string, webPreferences: WebPreferences, partition?: string): boolean {
    const descriptor = this.describeGuest(url, partition)
    if (!descriptor) return false
    this.pendingGuestDescriptors.push(descriptor)
    webPreferences.preload = fileURLToPath(descriptor.preload)
    if (descriptor.external) {
      const appPartition = this.managedTabs.get(descriptor.tabId!)?.definition.partition
      if (!appPartition) return false
      registerExternalAppProtocolForSession(session.fromPartition(appPartition), this.externalAppRegistry)
      webPreferences.partition = appPartition
      webPreferences.additionalArguments = [
        ...(webPreferences.additionalArguments ?? []),
        `--hxsy-app-id=${descriptor.appId}`,
      ]
    }
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = false
    webPreferences.webSecurity = true
    return true
  }

  attachGuest(contents: WebContents): boolean {
    if (this.destroyed || this.guestWebContents.has(contents.id)) return false
    const parsedDescriptor = this.describeGuest(contents.getURL())
    let pendingIndex = -1
    if (parsedDescriptor) {
      pendingIndex = this.pendingGuestDescriptors.findIndex(candidate =>
        candidate.kind === parsedDescriptor.kind && candidate.tabId === parsedDescriptor.tabId
      )
    } else if (this.pendingGuestDescriptors.length > 0) {
      pendingIndex = 0
    }
    const authorizedDescriptor = pendingIndex >= 0
      ? this.pendingGuestDescriptors.splice(pendingIndex, 1)[0]
      : null
    const descriptor = parsedDescriptor ?? authorizedDescriptor
    if (!descriptor) return false

    if (descriptor.kind === 'agent') {
      if (this.agentWebContents && !this.agentWebContents.isDestroyed()) return false
      this.agentWebContents = contents
      this.agentRendererReady = false
    } else if (descriptor.kind === 'home') {
      if (this.homeWebContents && !this.homeWebContents.isDestroyed()) return false
      this.homeWebContents = contents
    } else {
      const tab = descriptor.tabId ? this.managedTabs.get(descriptor.tabId) : undefined
      if (!tab || (tab.webContents && !tab.webContents.isDestroyed())) return false
      tab.webContents = contents
      this.tabManager.updateTabWebContentsId(tab.tab.id, contents.id)
      if (descriptor.internal && descriptor.appId === SETTINGS_APP_ID) {
        this.settingsWebContents = contents
      }
    }

    this.guestWebContents.set(contents.id, contents)
    this.registerSurface(contents.id, descriptor.kind, descriptor.tabId, descriptor.appId)
    this.installGuestGuards(contents, descriptor)
    contents.once('destroyed', () => this.detachGuest(contents.id))

    contents.once('did-finish-load', () => {
      windowLog.info(
        `App-platform surface ready: kind=${descriptor.kind}, wc=${contents.id}, rendererPid=${contents.getOSProcessId()}`
      )
      if (descriptor.internal && descriptor.appId === SETTINGS_APP_ID && !contents.isDestroyed()) {
        contents.send(APP_PLATFORM_CHANNELS.SETTINGS_NAVIGATE, this.lastSettingsSubpage)
      }
    })

    if (descriptor.kind === 'agent') {
      this.emitAgentPresentation()
    } else if (descriptor.kind === 'home') {
      this.emitInstalledApps()
    }
    this.emitState()
    return true
  }

  private installGuestGuards(contents: WebContents, descriptor: GuestDescriptor): void {
    const kind = descriptor.kind
    if (descriptor.external) {
      contents.setWindowOpenHandler(() => ({ action: 'allow' }))
      contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3 || !descriptor.appId) return
        this.externalAppRegistry.markRuntimeError(descriptor.appId, errorDescription || `Load failed: ${errorCode}`)
      })
      contents.on('render-process-gone', (_event, details) => {
        this.registeredWebToolHandlers.delete(contents.id)
        this.rejectWebToolCallsForRenderer(contents.id, `App renderer stopped: ${details.reason}`)
        windowLog.error(`Surface renderer gone: kind=${kind}, wc=${contents.id}, reason=${details.reason}`)
      })
      contents.on('did-start-navigation', () => {
        this.registeredWebToolHandlers.delete(contents.id)
        this.rejectWebToolCallsForRenderer(contents.id, 'App navigated before WebTool completed')
      })
      return
    }
    contents.setWindowOpenHandler(({ url }) => {
      if (kind === 'agent' && this.isSafeExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (this.describeGuest(url)) return
      event.preventDefault()
      if (kind === 'agent' && this.isSafeExternalUrl(url)) void shell.openExternal(url)
    })
    if (kind === 'agent') {
      contents.on('did-start-navigation', () => {
        this.agentRendererReady = false
      })
    }
    contents.on('render-process-gone', (_event, details) => {
      windowLog.error(`Surface renderer gone: kind=${kind}, wc=${contents.id}, reason=${details.reason}`)
    })
  }

  private isSafeExternalUrl(url: string): boolean {
    try {
      return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)
    } catch {
      return false
    }
  }

  private detachGuest(webContentsId: number): void {
    if (!this.guestWebContents.delete(webContentsId)) return
    this.registeredWebToolHandlers.delete(webContentsId)
    this.rejectWebToolCallsForRenderer(webContentsId, 'App renderer closed before WebTool completed')
    this.unregisterSurface(webContentsId)
    if (this.agentWebContents?.id === webContentsId) {
      this.agentWebContents = null
      this.agentRendererReady = false
    }
    if (this.homeWebContents?.id === webContentsId) this.homeWebContents = null
    const tab = [...this.managedTabs.values()].find(item => item.webContents?.id === webContentsId)
    if (tab) {
      tab.webContents = null
      this.tabManager.updateTabWebContentsId(tab.tab.id, this.nextPendingWebContentsId--)
    }
    if (this.settingsWebContents?.id === webContentsId) this.settingsWebContents = null
  }

  private handleResize = (): void => {
    const [contentWidth] = this.window.getContentSize()
    const state = this.tabManager.getState()
    this.tabManager.setAgentPanelWidth(clampAgentPanelWidth(contentWidth, state.agentPanelWidthPx))
    this.emitState()
  }

  getState(): ShellState {
    return {
      ...this.tabManager.getState(),
      workspaceId: this.workspaceId,
    }
  }

  getInstalledApps(): InstalledAppSummary[] {
    return buildInstalledAppSummaries(this.externalAppRegistry.list())
  }

  getAgentWebContentsId(): number | undefined {
    return this.agentWebContents?.id
  }

  getAgentWebContents(): WebContents | null {
    return this.agentWebContents
  }

  activateHome(): void {
    this.tabManager.activateHome()
    this.emitAllState()
  }

  openApp(appId: string): { appId: string; tabId: string; status: 'opened' | 'activated' } {
    const externalRecord = this.externalAppRegistry.get(appId)
    const tabId = randomUUID()
    const definition = appId === SETTINGS_APP_ID
      ? createSettingsDefinition(this.buildSettingsEntry(this.lastSettingsSubpage, tabId))
      : externalRecord ? this.definitionFromExternal(externalRecord) : null
    if (!definition) throw new Error(`Unknown app: ${appId}`)

    const transaction = this.tabManager.openAppTab({
      definition,
      tabId,
      webContentsId: this.nextPendingWebContentsId,
    })
    if (transaction.value.created) {
      this.nextPendingWebContentsId--
      this.managedTabs.set(transaction.value.tab.id, {
        tab: transaction.value.tab,
        definition,
        webContents: null,
      })
    }
    this.emitAllState()
    if (externalRecord?.status === 'discovered') {
      void this.externalAppRegistry.resolveRemote(appId)
    }
    return {
      appId,
      tabId: transaction.value.tab.id,
      status: transaction.value.created ? 'opened' : 'activated',
    }
  }

  closeApp(appId: string): { appId: string; tabId?: string; status: 'closed' | 'not-open' } {
    const tabs = [...this.managedTabs.values()].filter(item => item.definition.id === appId)
    if (tabs.length === 0) return { appId, status: 'not-open' }
    this.rejectWebToolWaitersForApp(appId, 'App closed before WebTool registered')
    for (const tab of tabs) this.closeTab(tab.tab.id)
    return { appId, tabId: tabs[0]?.tab.id, status: 'closed' }
  }

  async callWebTool(
    appId: string,
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const record = this.externalAppRegistry.get(appId)
    if (!record) throw new Error(`Unknown app: ${appId}`)
    if (record.status !== 'ready') throw new Error(`App ${appId} is not ready (status: ${record.status})`)
    const tool = record.webTools.find(candidate => candidate.name === functionName)
    if (!tool) {
      const available = record.webTools.map(candidate => candidate.name)
      throw new Error(`App ${appId} does not expose WebTool "${functionName}". Available: ${available.join(', ') || '(none)'}`)
    }
    const validationErrors = validateWebToolArguments(args, tool.inputSchema)
    if (validationErrors.length > 0) {
      throw new Error(`Invalid arguments for ${appId}.${functionName}: ${validationErrors.join('; ')}`)
    }
    if (![...this.managedTabs.values()].some(item => item.definition.id === appId)) {
      throw new Error(`App ${appId} is not open. Call open_app first.`)
    }

    const contents = await this.waitForRegisteredWebTool(appId, tool.handler)
    const callId = randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingWebToolCalls.delete(callId)
        reject(new Error(`WebTool call timed out after 15s: ${appId}.${functionName}`))
      }, 15_000)
      this.pendingWebToolCalls.set(callId, {
        webContentsId: contents.id,
        resolve,
        reject,
        timeout,
      })
      contents.send(APP_PLATFORM_CHANNELS.EXTERNAL_WEB_TOOL_INVOKE, {
        callId,
        handler: tool.handler,
        arguments: args,
      })
    })
  }

  handleWebToolRegistered(webContentsId: number, handler: string): void {
    const tab = [...this.managedTabs.values()].find(item => item.webContents?.id === webContentsId)
    if (!tab) return
    const record = this.externalAppRegistry.get(tab.definition.id)
    if (!record?.webTools.some(tool => tool.handler === handler)) {
      windowLog.warn(`[app-platform] Ignored undeclared WebTool handler registration: app=${tab.definition.id} handler=${handler}`)
      return
    }
    const handlers = this.registeredWebToolHandlers.get(webContentsId) ?? new Set<string>()
    handlers.add(handler)
    this.registeredWebToolHandlers.set(webContentsId, handlers)

    const key = `${tab.definition.id}::${handler}`
    const waiters = this.webToolRegistrationWaiters.get(key)
    if (!waiters) return
    this.webToolRegistrationWaiters.delete(key)
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout)
      waiter.resolve(tab.webContents!)
    }
  }

  handleWebToolResult(webContentsId: number, result: ExternalWebToolResult): void {
    const pending = this.pendingWebToolCalls.get(result.callId)
    if (!pending || pending.webContentsId !== webContentsId) return
    this.pendingWebToolCalls.delete(result.callId)
    clearTimeout(pending.timeout)
    if (result.ok) pending.resolve(result.result)
    else pending.reject(new Error(result.error || 'App WebTool failed'))
  }

  private waitForRegisteredWebTool(appId: string, handler: string): Promise<WebContents> {
    const tab = [...this.managedTabs.values()].find(item => item.definition.id === appId)
    const contents = tab?.webContents
    if (contents && !contents.isDestroyed() && this.registeredWebToolHandlers.get(contents.id)?.has(handler)) {
      return Promise.resolve(contents)
    }

    const key = `${appId}::${handler}`
    return new Promise((resolve, reject) => {
      const waiter: WebToolRegistrationWaiter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          const waiters = this.webToolRegistrationWaiters.get(key)
          waiters?.delete(waiter)
          if (waiters?.size === 0) this.webToolRegistrationWaiters.delete(key)
          reject(new Error(`App ${appId} did not register window.agent.tools.${handler} within 10s`))
        }, 10_000),
      }
      const waiters = this.webToolRegistrationWaiters.get(key) ?? new Set<WebToolRegistrationWaiter>()
      waiters.add(waiter)
      this.webToolRegistrationWaiters.set(key, waiters)
    })
  }

  private rejectWebToolCallsForRenderer(webContentsId: number, reason: string): void {
    for (const [callId, pending] of this.pendingWebToolCalls) {
      if (pending.webContentsId !== webContentsId) continue
      this.pendingWebToolCalls.delete(callId)
      clearTimeout(pending.timeout)
      pending.reject(new Error(reason))
    }
  }

  private rejectWebToolWaitersForApp(appId: string, reason: string): void {
    for (const [key, waiters] of this.webToolRegistrationWaiters) {
      if (!key.startsWith(`${appId}::`)) continue
      const pending = [...waiters]
      this.webToolRegistrationWaiters.delete(key)
      for (const waiter of pending) {
        clearTimeout(waiter.timeout)
        waiter.reject(new Error(reason))
      }
    }
  }

  openSettings(subpage?: string): void {
    const target = subpage === undefined
      ? this.lastSettingsSubpage
      : isValidSettingsSubpage(subpage) ? subpage : 'app'
    this.lastSettingsSubpage = target
    this.openApp(SETTINGS_APP_ID)
    const managed = [...this.managedTabs.values()].find(item => item.definition.id === SETTINGS_APP_ID)
    if (managed && (!managed.webContents || managed.webContents.isDestroyed())) {
      const definition = createSettingsDefinition(this.buildSettingsEntry(target, managed.tab.id))
      managed.definition = definition
      this.tabManager.updateAppTab(managed.tab.id, definition)
      this.emitAllState()
    } else if (this.settingsWebContents && !this.settingsWebContents.isDestroyed()) {
      this.settingsWebContents.send(APP_PLATFORM_CHANNELS.SETTINGS_NAVIGATE, target)
    }
  }

  setSettingsSubpage(subpage: string): void {
    if (!isValidSettingsSubpage(subpage)) throw new Error(`Unknown Settings subpage: ${subpage}`)
    this.lastSettingsSubpage = subpage
  }

  markSettingsRendererReady(webContentsId: number): void {
    if (!this.settingsWebContents || this.settingsWebContents.id !== webContentsId || this.settingsWebContents.isDestroyed()) {
      throw new Error(`Unknown Settings renderer: ${webContentsId}`)
    }
    const managed = [...this.managedTabs.values()].find(item => item.definition.id === SETTINGS_APP_ID)
    if (!managed) throw new Error('Settings tab is unavailable')
    const definition = createSettingsDefinition(managed.definition.entry, 'ready')
    managed.definition = definition
    this.tabManager.updateAppTab(managed.tab.id, definition)
    this.emitState()
  }

  updateWorkspace(workspaceId: string): void {
    if (!workspaceId || workspaceId === this.workspaceId) return
    this.workspaceId = workspaceId
    if (this.settingsWebContents && !this.settingsWebContents.isDestroyed()) {
      this.settingsWebContents.send(APP_PLATFORM_CHANNELS.SETTINGS_CONTEXT_CHANGED, { workspaceId })
    }
    // Shell owns workspace-sensitive chrome such as the active color theme.
    // Publish the new workspace even when Settings has not been opened.
    this.emitState()
  }

  getSettingsContext(): { workspaceId: string } {
    return { workspaceId: this.workspaceId }
  }

  private buildSettingsEntry(subpage: SettingsSubpage, tabId: string): string {
    const url = new URL(this.getWebviewBootstrap().settingsSrc)
    url.searchParams.set('tabId', tabId)
    url.hash = subpage
    return url.toString()
  }

  activateTab(tabId: string): void {
    this.tabManager.activateAppTab(tabId)
    this.emitAllState()
  }

  closeTab(tabId: string): void {
    const transaction = this.tabManager.closeAppTab(tabId)
    if (!transaction.value) return
    this.emitAllState()
    this.applyTabEffects(transaction.effects)
  }

  toggleAgentPanel(): void {
    this.tabManager.toggleAgentPanel()
    this.emitAllState()
  }

  focusAgentTab(intent?: AgentNavigationIntent): void {
    const transaction = this.tabManager.focusAgentTab(intent)
    this.emitAllState()
    this.applyTabEffects(transaction.effects)
  }

  unfocusAgentTab(): void {
    this.tabManager.unfocusAgentTab()
    this.emitAllState()
  }

  dockAgentAsPanel(): void {
    this.tabManager.dockAgentAsPanel()
    this.emitAllState()
  }

  openAgentPanel(): void {
    this.tabManager.ensureAgentPanelVisible()
    this.emitAllState()
  }

  async retryExternalApp(appId: string): Promise<void> {
    await this.externalAppRegistry.retry(appId)
  }

  setPanelWidth(widthPx: number): void {
    const [contentWidth] = this.window.getContentSize()
    this.tabManager.setAgentPanelWidth(clampAgentPanelWidth(contentWidth, widthPx))
    this.emitState()
  }

  sendAgentCommand(command: AgentShellCommand): void {
    this.tabManager.focusAgentTab()
    this.emitAllState()
    if (this.agentRendererReady && this.agentWebContents && !this.agentWebContents.isDestroyed()) {
      this.agentWebContents.send(APP_PLATFORM_CHANNELS.AGENT_COMMAND_RECEIVED, command)
    } else {
      this.queuedAgentCommands.push(command)
    }
  }

  markAgentRendererReady(webContentsId: number): void {
    if (!this.agentWebContents || this.agentWebContents.id !== webContentsId || this.agentWebContents.isDestroyed()) {
      throw new Error(`Unknown Agent renderer: ${webContentsId}`)
    }
    this.agentRendererReady = true
    for (const intent of this.queuedAgentNavigationIntents.splice(0)) {
      this.agentWebContents.send(APP_PLATFORM_CHANNELS.AGENT_NAVIGATION_INTENT_RECEIVED, intent)
    }
    for (const command of this.queuedAgentCommands.splice(0)) {
      this.agentWebContents.send(APP_PLATFORM_CHANNELS.AGENT_COMMAND_RECEIVED, command)
    }
  }

  private applyTabEffects(effects: readonly ShellTabEffect[]): void {
    for (const effect of effects) {
      if (effect.type === 'close-app-renderer') {
        const managed = this.managedTabs.get(effect.tab.id)
        this.managedTabs.delete(effect.tab.id)
        this.rejectWebToolWaitersForApp(effect.tab.appId, 'App closed before WebTool registered')
        if (managed?.webContents && !managed.webContents.isDestroyed()) managed.webContents.close()
        continue
      }
      if (this.agentRendererReady && this.agentWebContents && !this.agentWebContents.isDestroyed()) {
        this.agentWebContents.send(APP_PLATFORM_CHANNELS.AGENT_NAVIGATION_INTENT_RECEIVED, effect.intent)
      } else {
        this.queuedAgentNavigationIntents.push(effect.intent)
      }
    }
  }

  private definitionFromExternal(record: ExternalAppRecord): AppDefinition {
    return {
      id: record.appId,
      title: record.title,
      entry: record.entryUrl ?? '',
      kind: 'external',
      instancePolicy: 'single',
      capabilities: [],
      iconUrl: record.iconUrl,
      status: record.status,
      error: record.error,
      partition: `persist:hxsy-app-${record.appId}`,
    }
  }

  private handleExternalAppsChanged = (records: ExternalAppRecord[]): void => {
    const byId = new Map(records.map(record => [record.appId, record]))
    const effects: ShellTabEffect[] = []
    for (const [tabId, managed] of [...this.managedTabs]) {
      if (managed.definition.kind !== 'external') continue
      const record = byId.get(managed.definition.id)
      if (!record) {
        const transaction = this.tabManager.closeAppTab(tabId)
        effects.push(...transaction.effects)
        continue
      }
      const definition = this.definitionFromExternal(record)
      managed.definition = definition
      this.tabManager.updateAppTab(tabId, definition)
    }
    this.emitState()
    this.emitInstalledApps()
    this.applyTabEffects(effects)
  }

  private emitInstalledApps(): void {
    if (this.homeWebContents && !this.homeWebContents.isDestroyed()) {
      this.homeWebContents.send(APP_PLATFORM_CHANNELS.INSTALLED_APPS_CHANGED, this.getInstalledApps())
    }
  }

  private emitState(): void {
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(APP_PLATFORM_CHANNELS.STATE_CHANGED, this.getState())
    }
  }

  private emitAgentPresentation(): void {
    if (this.agentWebContents && !this.agentWebContents.isDestroyed()) {
      this.agentWebContents.send(
        APP_PLATFORM_CHANNELS.AGENT_PRESENTATION_CHANGED,
        deriveAgentPresentationState(this.getState())
      )
    }
  }

  private emitAllState(): void {
    this.emitState()
    this.emitAgentPresentation()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.window.removeListener('resize', this.handleResize)
    this.unsubscribeExternalApps()
    for (const pending of this.pendingWebToolCalls.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('App shell destroyed before WebTool completed'))
    }
    this.pendingWebToolCalls.clear()
    for (const waiters of this.webToolRegistrationWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout)
        waiter.reject(new Error('App shell destroyed before WebTool registered'))
      }
    }
    this.webToolRegistrationWaiters.clear()
    for (const contents of this.guestWebContents.values()) {
      if (!contents.isDestroyed()) contents.close()
    }
    this.guestWebContents.clear()
    this.pendingGuestDescriptors.length = 0
    this.managedTabs.clear()
    this.queuedAgentCommands.length = 0
    this.queuedAgentNavigationIntents.length = 0
    this.agentWebContents = null
    this.agentRendererReady = false
    this.homeWebContents = null
    this.settingsWebContents = null
  }
}

function validateWebToolArguments(
  value: unknown,
  schema: Record<string, unknown>,
  path = 'arguments',
  depth = 0,
): string[] {
  if (depth > 10) return [`${path} exceeds maximum schema depth`]
  if ('const' in schema && !Object.is(schema.const, value)) {
    return [`${path} must equal ${JSON.stringify(schema.const)}`]
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(candidate => Object.is(candidate, value))) {
    return [`${path} must be one of ${JSON.stringify(schema.enum)}`]
  }

  if (Array.isArray(schema.allOf)) {
    return schema.allOf.flatMap((candidate, index) =>
      candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? validateWebToolArguments(value, candidate as Record<string, unknown>, `${path}.allOf[${index}]`, depth + 1)
        : [`${path}.allOf[${index}] is not a schema object`]
    )
  }
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const candidates = schema[keyword]
    if (!Array.isArray(candidates)) continue
    const matches = candidates.filter(candidate =>
      candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && validateWebToolArguments(value, candidate as Record<string, unknown>, path, depth + 1).length === 0
    ).length
    if (keyword === 'anyOf' && matches === 0) return [`${path} must match at least one anyOf schema`]
    if (keyword === 'oneOf' && matches !== 1) return [`${path} must match exactly one oneOf schema`]
  }

  const type = schema.type
  if (Array.isArray(type)) {
    const matches = type.some(candidate =>
      typeof candidate === 'string'
      && validateWebToolArguments(value, { ...schema, type: candidate }, path, depth + 1).length === 0
    )
    return matches ? [] : [`${path} does not match allowed types: ${type.join(', ')}`]
  }
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path} must be an object`]
    const object = value as Record<string, unknown>
    const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? schema.properties as Record<string, Record<string, unknown>>
      : {}
    const errors: string[] = []
    for (const required of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof required === 'string' && !(required in object)) errors.push(`${path}.${required} is required`)
    }
    for (const [key, child] of Object.entries(object)) {
      const childSchema = properties[key]
      if (childSchema) errors.push(...validateWebToolArguments(child, childSchema, `${path}.${key}`, depth + 1))
      else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`)
    }
    return errors
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return [`${path} must be an array`]
    const errors: string[] = []
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${path} must contain at least ${schema.minItems} items`)
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${path} must contain at most ${schema.maxItems} items`)
    const itemSchema = schema.items
    if (!itemSchema || typeof itemSchema !== 'object' || Array.isArray(itemSchema)) return errors
    errors.push(...value.flatMap((item, index) => validateWebToolArguments(
      item,
      itemSchema as Record<string, unknown>,
      `${path}[${index}]`,
      depth + 1,
    )))
    return errors
  }
  if (type === 'string') {
    if (typeof value !== 'string') return [`${path} must be a string`]
    const errors: string[] = []
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${path} must contain at least ${schema.minLength} characters`)
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${path} must contain at most ${schema.maxLength} characters`)
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(`${path} must match pattern ${schema.pattern}`)
      } catch {
        errors.push(`${path} manifest pattern is invalid`)
      }
    }
    return errors
  }
  if (type === 'number' && typeof value !== 'number') return [`${path} must be a number`]
  if (type === 'integer' && (!Number.isInteger(value))) return [`${path} must be an integer`]
  if (type === 'boolean' && typeof value !== 'boolean') return [`${path} must be a boolean`]
  if (type === 'null' && value !== null) return [`${path} must be null`]
  if ((type === 'number' || type === 'integer') && typeof value === 'number') {
    const errors: string[] = []
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`)
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`)
    return errors
  }
  return []
}
