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
import { BROWSER_APP_ID, buildInstalledAppSummaries, createSettingsDefinition, SETTINGS_APP_ID } from './internal-app-registry'
import { isValidSettingsSubpage, type SettingsSubpage } from '../shared/settings-registry'
import { BrowserCDP } from './browser-cdp'
import type { BrowserTabBackend, BrowserTabHost } from './browser-tab-host'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

interface ShellViewManagerOptions {
  window: BrowserWindow
  workspaceId: string
  initialActiveTarget?: 'home' | 'agent'
  externalAppRegistry: ExternalAppRegistry
  registerSurface: (webContentsId: number, kind: Exclude<SurfaceKind, 'shell'>, tabId?: string, appId?: string) => void
  unregisterSurface: (webContentsId: number) => void
  browserTabs?: BrowserTabBackend
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
  kind: 'home' | 'agent' | 'app' | 'browser'
  tabId?: string
  appId?: string
  external?: boolean
  internal?: boolean
  preload: string
  browserInstanceId?: string
}

const BROWSER_INSTANCE_ARGUMENT_PREFIX = '--hxsy-browser-instance-id='

export class ShellViewManager {
  private readonly window: BrowserWindow
  private workspaceId: string
  private readonly registerSurface: ShellViewManagerOptions['registerSurface']
  private readonly unregisterSurface: ShellViewManagerOptions['unregisterSurface']
  private readonly externalAppRegistry: ExternalAppRegistry
  private readonly browserTabs?: BrowserTabBackend
  private readonly unsubscribeExternalApps: () => void
  private readonly managedTabs = new Map<string, ManagedTab>()
  private readonly registeredWebToolHandlers = new Map<number, Set<string>>()
  private readonly pendingWebToolCalls = new Map<string, PendingWebToolCall>()
  private readonly webToolRegistrationWaiters = new Map<string, Set<WebToolRegistrationWaiter>>()
  private readonly appBrowserControllers = new Map<number, BrowserCDP>()
  private readonly guestWebContents = new Map<number, WebContents>()
  private readonly pendingGuestDescriptors: GuestDescriptor[] = []
  private readonly queuedAgentCommands: AgentShellCommand[] = []
  private readonly queuedAgentNavigationIntents: AgentNavigationIntent[] = []
  private readonly queuedAgentPanelNavigationIntents: AgentNavigationIntent[] = []
  private readonly tabManager: ShellTabManager
  private agentWebContents: WebContents | null = null
  private agentRendererReady = false
  private agentPanelRendererReady = false
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
    this.browserTabs = options.browserTabs

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
      agent.searchParams.set('surface', 'agent-full')
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
    agent.searchParams.set('surface', 'agent-full')
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

      const browser = [...this.managedTabs.values()].find(item =>
        item.definition.kind === 'browser'
        && item.definition.browserInstanceId
        && item.definition.entry === url
        && (!partition || item.definition.partition === partition)
      )
      if (browser) {
        return {
          kind: 'browser',
          tabId: browser.tab.id,
          appId: BROWSER_APP_ID,
          browserInstanceId: browser.definition.browserInstanceId,
          preload: '',
        }
      }

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

      if (parsed.pathname === agentEntry.pathname && parsed.searchParams.get('surface') === 'agent-full') {
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
    if (descriptor.preload) webPreferences.preload = fileURLToPath(descriptor.preload)
    else delete webPreferences.preload
    if (descriptor.kind === 'browser') {
      webPreferences.partition = `persist:browser-pane`
      webPreferences.additionalArguments = [
        ...(webPreferences.additionalArguments ?? []).filter(
          argument => !argument.startsWith(BROWSER_INSTANCE_ARGUMENT_PREFIX),
        ),
        `${BROWSER_INSTANCE_ARGUMENT_PREFIX}${descriptor.browserInstanceId}`,
      ]
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      return true
    }
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

  attachGuest(contents: WebContents, urlHint?: string): boolean {
    if (this.destroyed || this.guestWebContents.has(contents.id)) return false
    const parsedDescriptor = this.describeGuest(urlHint || contents.getURL())
    const attachedPreferences = (contents as WebContents & {
      getLastWebPreferences?: () => WebPreferences
    }).getLastWebPreferences?.()
    const browserInstanceArgument = attachedPreferences?.additionalArguments?.find((argument: string) =>
      argument.startsWith(BROWSER_INSTANCE_ARGUMENT_PREFIX)
    )
    const attachedBrowserInstanceId = browserInstanceArgument
      ? browserInstanceArgument.slice(BROWSER_INSTANCE_ARGUMENT_PREFIX.length)
      : null
    let pendingIndex = -1
    if (attachedBrowserInstanceId) {
      pendingIndex = this.pendingGuestDescriptors.findIndex(candidate =>
        candidate.kind === 'browser' && candidate.browserInstanceId === attachedBrowserInstanceId
      )
    } else if (parsedDescriptor) {
      pendingIndex = this.pendingGuestDescriptors.findIndex(candidate =>
        candidate.kind === parsedDescriptor.kind && candidate.tabId === parsedDescriptor.tabId
      )
    }
    const authorizedDescriptor = pendingIndex >= 0
      ? this.pendingGuestDescriptors.splice(pendingIndex, 1)[0]
      : null
    const descriptor = attachedBrowserInstanceId
      ? authorizedDescriptor
      : parsedDescriptor ?? authorizedDescriptor
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
      if (descriptor.kind === 'browser' && descriptor.browserInstanceId && tab) {
        const host = this.createBrowserTabHost(tab.tab.id)
        this.browserTabs?.attachTabWebContents(descriptor.browserInstanceId, contents, host)
      }
    }

    this.guestWebContents.set(contents.id, contents)
    this.registerSurface(contents.id, descriptor.kind === 'browser' ? 'app' : descriptor.kind, descriptor.tabId, descriptor.appId)
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
    if (kind === 'browser') {
      // BrowserPaneManager owns setWindowOpenHandler for Browser App guests.
      // Do not overwrite it here: its handler converts window.open/_blank into
      // sibling Browser Tabs and retains a native-window fallback only when no
      // Shell host exists.
      contents.on('render-process-gone', (_event, details) => {
        windowLog.error(`Browser renderer gone: wc=${contents.id}, reason=${details.reason}`)
      })
      return
    }
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
        this.resetAppBrowserController(contents.id)
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
    this.resetAppBrowserController(webContentsId)
    this.rejectWebToolCallsForRenderer(webContentsId, 'App renderer closed before WebTool completed')
    this.unregisterSurface(webContentsId)
    if (this.agentWebContents?.id === webContentsId) {
      this.agentWebContents = null
      this.agentRendererReady = false
    }
    if (this.homeWebContents?.id === webContentsId) this.homeWebContents = null
    const tab = [...this.managedTabs.values()].find(item => item.webContents?.id === webContentsId)
    if (tab) {
      if (tab.definition.kind === 'browser' && tab.definition.browserInstanceId) {
        this.browserTabs?.detachTabWebContents(tab.definition.browserInstanceId, webContentsId)
        this.closeTab(tab.tab.id)
        return
      }
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
    if (appId === BROWSER_APP_ID) {
      if (!this.browserTabs) throw new Error('Built-in browser is unavailable')
      const instanceId = this.browserTabs.createManualBrowser(this.workspaceId)
      const managed = [...this.managedTabs.values()].find(item => item.definition.browserInstanceId === instanceId)
      return { appId, tabId: managed?.tab.id ?? instanceId, status: 'opened' }
    }
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

  openBrowserTab(
    instanceId: string,
    options: { initialUrl?: string; show?: boolean } = {},
  ): { tabId: string; created: boolean } {
    const existing = [...this.managedTabs.values()].find(item => item.definition.browserInstanceId === instanceId)
    if (existing) {
      if (options.show !== false) this.tabManager.activateAppTab(existing.tab.id)
      this.emitAllState()
      return { tabId: existing.tab.id, created: false }
    }

    const tabId = randomUUID()
    // Unique URL keeps concurrent blank browser guests distinguishable during
    // will-attach-webview authorization; all share the same cookie partition.
    const initialUrl = options.initialUrl || this.buildBrowserEmptyStateEntry(instanceId)
    const definition: AppDefinition = {
      id: BROWSER_APP_ID,
      title: '新标签页',
      entry: initialUrl,
      kind: 'browser',
      instancePolicy: 'multiple',
      capabilities: ['browser'],
      status: 'ready',
      partition: 'persist:browser-pane',
      browserInstanceId: instanceId,
    }
    const transaction = this.tabManager.openAppTab({
      definition,
      tabId,
      webContentsId: this.nextPendingWebContentsId--,
      activate: options.show !== false,
    })
    this.managedTabs.set(tabId, { tab: transaction.value.tab, definition, webContents: null })
    this.emitAllState()
    return { tabId, created: true }
  }

  hasBrowserInstance(instanceId: string): boolean {
    return [...this.managedTabs.values()].some(item => item.definition.browserInstanceId === instanceId)
  }

  focusBrowserInstance(instanceId: string): boolean {
    const managed = [...this.managedTabs.values()].find(item => item.definition.browserInstanceId === instanceId)
    if (!managed) return false
    this.tabManager.activateAppTab(managed.tab.id)
    if (this.window.isMinimized()) this.window.restore()
    this.window.focus()
    this.emitAllState()
    return true
  }

  hideBrowserInstance(instanceId: string): boolean {
    const managed = [...this.managedTabs.values()].find(item => item.definition.browserInstanceId === instanceId)
    if (!managed) return false
    const state = this.tabManager.getState()
    if (state.activeTarget.kind === 'app' && state.activeTarget.tabId === managed.tab.id) {
      this.tabManager.activateHome()
      this.emitAllState()
    }
    return true
  }

  closeBrowserInstance(instanceId: string): boolean {
    const managed = [...this.managedTabs.values()].find(item => item.definition.browserInstanceId === instanceId)
    if (!managed) return false
    this.closeTab(managed.tab.id)
    return true
  }

  private createBrowserTabHost(tabId: string): BrowserTabHost {
    let previousTarget: ShellState['activeTarget'] | null = null
    return {
      tabId,
      show: () => {
        if (!this.managedTabs.has(tabId)) return
        const current = this.tabManager.getState().activeTarget
        if (!(current.kind === 'app' && current.tabId === tabId)) previousTarget = current
        this.tabManager.activateAppTab(tabId)
        if (this.window.isMinimized()) this.window.restore()
        this.window.focus()
        this.emitAllState()
      },
      hide: () => {
        const state = this.tabManager.getState()
        if (state.activeTarget.kind === 'app' && state.activeTarget.tabId === tabId) {
          if (previousTarget?.kind === 'app' && this.managedTabs.has(previousTarget.tabId)) {
            this.tabManager.activateAppTab(previousTarget.tabId)
          } else if (previousTarget?.kind === 'agent') {
            this.tabManager.focusAgentTab()
          } else {
            this.tabManager.activateHome()
          }
          previousTarget = null
          this.emitAllState()
        }
      },
      close: () => this.closeTab(tabId),
      update: (info, agentControlLabel) => {
        if (!this.managedTabs.has(tabId)) return
        this.tabManager.updateBrowserTab(tabId, {
          url: info.url,
          title: info.title || '新标签页',
          favicon: info.favicon,
          isLoading: info.isLoading,
          canGoBack: info.canGoBack,
          canGoForward: info.canGoForward,
          agentControlLabel,
        })
        this.emitState()
      },
      setViewport: (width, height) => {
        const applied = { width: Math.max(320, Math.round(width)), height: Math.max(240, Math.round(height)) }
        this.tabManager.updateBrowserTab(tabId, { viewportWidth: applied.width, viewportHeight: applied.height })
        this.emitState()
        return applied
      },
      getViewport: () => {
        const tab = this.tabManager.getState().tabs.find(candidate => candidate.id === tabId)
        return {
          width: tab?.browserState?.viewportWidth ?? 1200,
          height: tab?.browserState?.viewportHeight ?? 852,
        }
      },
    }
  }

  private buildBrowserEmptyStateEntry(instanceId: string): string {
    const url = VITE_DEV_SERVER_URL
      ? new URL('/browser-empty-state.html', VITE_DEV_SERVER_URL)
      : pathToFileURL(join(__dirname, 'renderer/browser-empty-state.html'))
    url.searchParams.set('browserInstanceId', instanceId)
    return url.toString()
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

  async appBrowser(appId: string, command: string | string[]): Promise<unknown> {
    const managed = [...this.managedTabs.values()].find(item => item.definition.id === appId)
    const contents = managed?.webContents
    if (!managed || !contents || contents.isDestroyed()) {
      throw new Error(`App ${appId} is not open or its WebView is not ready. Call open_app first.`)
    }
    const tokens = normalizeAppBrowserCommand(command)
    const action = tokens.shift()?.toLowerCase()
    if (!action || action === '--help' || action === 'help') return getAppBrowserHelp()

    const cdp = this.getAppBrowserController(contents)
    let result: unknown

    switch (action) {
      case 'source':
      case 'html': {
        const selector = tokens.join(' ').trim()
        result = await contents.executeJavaScript(`(() => {
          const selector = ${JSON.stringify(selector)};
          const node = selector ? document.querySelector(selector) : document.documentElement;
          if (!node) throw new Error('Selector not found: ' + selector);
          const html = node.outerHTML || '';
          const limit = 200000;
          return { html: html.slice(0, limit), truncated: html.length > limit, totalCharacters: html.length };
        })()`)
        break
      }
      case 'snapshot':
        result = await cdp.getAccessibilitySnapshot()
        break
      case 'click': {
        const ref = requireAppBrowserArg(tokens[0], 'click requires an @eN ref')
        result = await cdp.clickElement(ref)
        break
      }
      case 'click-at': {
        const [x, y] = parseAppBrowserNumbers(tokens, 2, 'click-at requires x y')
        await cdp.clickAtCoordinates(x!, y!)
        result = { x, y }
        break
      }
      case 'fill': {
        const ref = requireAppBrowserArg(tokens.shift(), 'fill requires ref and value')
        const value = tokens.join(' ')
        if (tokens.length === 0) throw new Error('fill requires ref and value')
        result = await cdp.fillElement(ref, value)
        break
      }
      case 'type': {
        const text = tokens.join(' ')
        if (!text) throw new Error('type requires text')
        await cdp.typeText(text)
        result = { typed: text.length }
        break
      }
      case 'select': {
        const ref = requireAppBrowserArg(tokens.shift(), 'select requires ref and value')
        const value = tokens.join(' ')
        if (tokens.length === 0) throw new Error('select requires ref and value')
        result = await cdp.selectOption(ref, value)
        break
      }
      case 'scroll': {
        const direction = requireAppBrowserArg(tokens[0], 'scroll requires direction')
        if (!['up', 'down', 'left', 'right'].includes(direction)) {
          throw new Error('scroll direction must be up, down, left, or right')
        }
        const amount = tokens[1] === undefined ? 500 : Number(tokens[1])
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('scroll amount must be a positive number')
        result = await contents.executeJavaScript(`(() => {
          const direction = ${JSON.stringify(direction)};
          const amount = ${amount};
          const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
          const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
          window.scrollBy({ left: dx, top: dy, behavior: 'auto' });
          return { scrollX: window.scrollX, scrollY: window.scrollY };
        })()`)
        break
      }
      case 'drag': {
        if (tokens.length === 2 && tokens.every(token => /^@e\d+$/.test(token))) {
          const from = await cdp.getElementGeometry(tokens[0]!)
          const to = await cdp.getElementGeometry(tokens[1]!)
          await cdp.drag(from.clickPoint.x, from.clickPoint.y, to.clickPoint.x, to.clickPoint.y)
          result = { from, to }
        } else {
          const [x1, y1, x2, y2] = parseAppBrowserNumbers(tokens, 4, 'drag requires sourceRef targetRef or x1 y1 x2 y2')
          await cdp.drag(x1!, y1!, x2!, y2!)
          result = { x1, y1, x2, y2 }
        }
        break
      }
      case 'key': {
        const keyCode = requireAppBrowserArg(tokens.shift(), 'key requires a key name')
        const modifiers = tokens.filter(token => ['shift', 'control', 'alt', 'meta'].includes(token.toLowerCase()))
          .map(token => token.toLowerCase()) as Array<'shift' | 'control' | 'alt' | 'meta'>
        contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
        result = { key: keyCode, modifiers }
        break
      }
      case 'text': {
        const selector = tokens.join(' ').trim() || 'body'
        result = await contents.executeJavaScript(`(() => {
          const selector = ${JSON.stringify(selector)};
          const node = document.querySelector(selector);
          if (!node) throw new Error('Selector not found: ' + selector);
          const text = node.innerText || node.textContent || '';
          const limit = 100000;
          return { text: text.slice(0, limit), truncated: text.length > limit, totalCharacters: text.length };
        })()`)
        break
      }
      case 'evaluate': {
        const expression = tokens.join(' ')
        if (!expression) throw new Error('evaluate requires a JavaScript expression')
        result = limitAppBrowserResult(await evaluateInAppRenderer(contents, expression))
        break
      }
      case 'title':
        result = contents.getTitle()
        break
      case 'url':
        result = contents.getURL()
        break
      case 'back':
        contents.goBack()
        result = { navigated: 'back' }
        break
      case 'forward':
        contents.goForward()
        result = { navigated: 'forward' }
        break
      case 'reload':
        contents.reload()
        result = { reloaded: true }
        break
      default:
        throw new Error(`Unknown app_browser command: ${action}. Use --help.`)
    }

    return {
      appId,
      command: action,
      url: contents.getURL(),
      title: contents.getTitle(),
      result,
    }
  }

  private getAppBrowserController(contents: WebContents): BrowserCDP {
    const existing = this.appBrowserControllers.get(contents.id)
    if (existing) return existing
    const controller = new BrowserCDP(contents)
    this.appBrowserControllers.set(contents.id, controller)
    return controller
  }

  private resetAppBrowserController(webContentsId: number): void {
    this.appBrowserControllers.get(webContentsId)?.detach()
    this.appBrowserControllers.delete(webContentsId)
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

  reorderTab(tabId: string, targetTabId: string, placement: 'before' | 'after'): void {
    this.tabManager.reorderAppTab(tabId, targetTabId, placement)
    this.emitState()
  }

  setTabOrder(tabIds: string[]): void {
    this.tabManager.setAppTabOrder(tabIds)
    this.emitState()
  }

  closeTabsRight(tabId: string): void {
    const tabs = this.tabManager.getState().tabs
    const index = tabs.findIndex(tab => tab.id === tabId)
    if (index < 0) throw new Error(`Unknown app tab: ${tabId}`)
    this.closeTabIds(tabs.slice(index + 1).map(tab => tab.id))
  }

  closeOtherTabs(tabId: string): void {
    const tabs = this.tabManager.getState().tabs
    if (!tabs.some(tab => tab.id === tabId)) throw new Error(`Unknown app tab: ${tabId}`)
    this.closeTabIds(tabs.filter(tab => tab.id !== tabId).map(tab => tab.id))
  }

  private closeTabIds(tabIds: readonly string[]): void {
    if (tabIds.length === 0) return
    const effects: ShellTabEffect[] = []
    for (const tabId of tabIds) {
      effects.push(...this.tabManager.closeAppTab(tabId).effects)
    }
    this.emitAllState()
    this.applyTabEffects(effects)
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

  dockAgentAsPanel(intent?: AgentNavigationIntent): void {
    if (intent && (intent.type !== 'conversation' || !intent.sessionId.trim())) {
      throw new Error('Invalid Agent navigation intent')
    }
    this.tabManager.dockAgentAsPanel()
    this.emitAllState()
    if (!intent) return
    if (this.window.webContents.isDestroyed()) return
    if (this.agentPanelRendererReady) {
      this.window.webContents.send(APP_PLATFORM_CHANNELS.AGENT_NAVIGATION_INTENT_RECEIVED, intent)
    } else {
      this.queuedAgentPanelNavigationIntents.push(intent)
    }
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
    if (this.window.webContents.id === webContentsId && !this.window.webContents.isDestroyed()) {
      this.agentPanelRendererReady = true
      for (const intent of this.queuedAgentPanelNavigationIntents.splice(0)) {
        this.window.webContents.send(APP_PLATFORM_CHANNELS.AGENT_NAVIGATION_INTENT_RECEIVED, intent)
      }
      return
    }
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
        if (managed?.definition.kind === 'browser' && managed.definition.browserInstanceId) {
          this.browserTabs?.detachTabWebContents(
            managed.definition.browserInstanceId,
            managed.webContents?.id ?? managed.tab.webContentsId,
          )
        }
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
    const state = this.getState()
    for (const tab of state.tabs) {
      if (tab.kind !== 'browser' || !tab.browserInstanceId) continue
      const visible = state.activeTarget.kind === 'app' && state.activeTarget.tabId === tab.id
      this.browserTabs?.setTabVisibility(tab.browserInstanceId, visible)
    }
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(APP_PLATFORM_CHANNELS.STATE_CHANGED, state)
    }
  }

  private emitAgentPresentation(): void {
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(
        APP_PLATFORM_CHANNELS.AGENT_PRESENTATION_CHANGED,
        deriveAgentPresentationState(this.getState())
      )
    }
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
    for (const controller of this.appBrowserControllers.values()) controller.detach()
    this.appBrowserControllers.clear()
    for (const contents of this.guestWebContents.values()) {
      if (!contents.isDestroyed()) contents.close()
    }
    this.guestWebContents.clear()
    this.pendingGuestDescriptors.length = 0
    this.managedTabs.clear()
    this.queuedAgentCommands.length = 0
    this.queuedAgentNavigationIntents.length = 0
    this.queuedAgentPanelNavigationIntents.length = 0
    this.agentWebContents = null
    this.agentRendererReady = false
    this.agentPanelRendererReady = false
    this.homeWebContents = null
    this.settingsWebContents = null
  }
}

function getAppBrowserHelp(): string {
  return [
    'app_browser commands:',
    '  source [selector]',
    '  snapshot',
    '  click <@eN>',
    '  click-at <x> <y>',
    '  fill <@eN> <value>',
    '  type <text>',
    '  select <@eN> <value>',
    '  scroll <up|down|left|right> [amount]',
    '  drag <sourceRef> <targetRef>',
    '  drag <x1> <y1> <x2> <y2>',
    '  key <key> [shift|control|alt|meta...]',
    '  text [selector]',
    '  evaluate <expression>',
    '  title | url | back | forward | reload',
    '',
    'Workflow: open_app → snapshot → action using @eN → snapshot again.',
    'Prefer array command form when values contain spaces or JavaScript.',
  ].join('\n')
}

function tokenizeAppBrowserCommand(input: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const char of input.trim()) {
    if (escaped) {
      token += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else token += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (token) {
        tokens.push(token)
        token = ''
      }
      continue
    }
    token += char
  }
  if (escaped) token += '\\'
  if (quote) throw new Error('Unterminated quote in app_browser command')
  if (token) tokens.push(token)
  return tokens
}

function normalizeAppBrowserCommand(command: string | string[]): string[] {
  if (Array.isArray(command)) return command.map(String)
  const trimmed = command.trim()
  if (!trimmed.startsWith('[')) {
    // JavaScript expressions must retain their quotes/backslashes verbatim.
    // Shell-style tokenization would turn getElementById("todo-title") into
    // getElementById(todo-title), producing `todo is not defined`.
    const evaluateMatch = trimmed.match(/^evaluate(?:\s+([\s\S]*))?$/i)
    if (evaluateMatch) {
      return ['evaluate', evaluateMatch[1] ?? '']
    }
    return tokenizeAppBrowserCommand(trimmed)
  }

  // Models sometimes serialize array-form commands into the string field.
  // Accept both strict JSON (`["evaluate", "document.title"]`) and the common
  // agent shorthand (`[evaluate, document.title]`).
  if (trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      // Fall through to the lenient bracket-array parser.
    }
  }

  const body = trimmed.slice(1, trimmed.endsWith(']') ? -1 : undefined).trim()
  const separator = findTopLevelComma(body)
  if (separator < 0) return tokenizeAppBrowserCommand(body)
  const action = stripMatchingQuotes(body.slice(0, separator).trim())
  const remainder = body.slice(separator + 1).trim()

  // These commands treat everything after the command name as one payload;
  // commas inside JS, selectors, or text must survive unchanged.
  if (['evaluate', 'type', 'source', 'html', 'text'].includes(action.toLowerCase())) {
    return [action, stripMatchingQuotes(remainder)]
  }

  return [action, ...splitTopLevelCommaList(remainder).map(stripMatchingQuotes)]
}

function findTopLevelComma(value: string): number {
  let quote: '"' | "'" | '`' | null = null
  let escaped = false
  let depth = 0
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth++
    else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1)
    else if (char === ',' && depth === 0) return index
  }
  return -1
}

function splitTopLevelCommaList(value: string): string[] {
  const parts: string[] = []
  let remaining = value
  while (remaining) {
    const separator = findTopLevelComma(remaining)
    if (separator < 0) {
      parts.push(remaining.trim())
      break
    }
    parts.push(remaining.slice(0, separator).trim())
    remaining = remaining.slice(separator + 1).trim()
  }
  return parts.filter(part => part.length > 0)
}

function stripMatchingQuotes(value: string): string {
  if (value.length < 2) return value
  const first = value[0]
  const last = value[value.length - 1]
  return first === last && (first === '"' || first === "'" || first === '`')
    ? value.slice(1, -1)
    : value
}

async function evaluateInAppRenderer(contents: WebContents, expression: string): Promise<unknown> {
  const envelope = await contents.executeJavaScript(`(async () => {
    try {
      const value = await (0, eval)(${JSON.stringify(expression)});
      try {
        if (value === undefined) return { __hxsyAppBrowserOk: true, value: null };
        const serialized = JSON.stringify(value);
        if (serialized === undefined) {
          throw new Error('JSON.stringify returned undefined');
        }
        return { __hxsyAppBrowserOk: true, value: JSON.parse(serialized) };
      } catch (serializationError) {
        return {
          __hxsyAppBrowserOk: false,
          error: 'Evaluation result is not serializable: ' + String(serializationError),
        };
      }
    } catch (error) {
      return {
        __hxsyAppBrowserOk: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
    }
  })()`)

  if (!envelope || typeof envelope !== 'object' || !('__hxsyAppBrowserOk' in envelope)) {
    throw new Error('Renderer evaluate returned an invalid response envelope')
  }
  const response = envelope as {
    __hxsyAppBrowserOk: boolean
    value?: unknown
    error?: string
    stack?: string
  }
  if (!response.__hxsyAppBrowserOk) {
    throw new Error([
      `Renderer evaluate failed: ${response.error || 'Unknown renderer error'}`,
      response.stack,
    ].filter(Boolean).join('\n'))
  }
  return response.value ?? null
}

function requireAppBrowserArg(value: string | undefined, error: string): string {
  if (!value) throw new Error(error)
  return value
}

function parseAppBrowserNumbers(tokens: string[], count: number, error: string): number[] {
  if (tokens.length !== count) throw new Error(error)
  const numbers = tokens.map(Number)
  if (numbers.some(value => !Number.isFinite(value))) throw new Error(error)
  return numbers
}

function limitAppBrowserResult(value: unknown): unknown {
  if (value === undefined) return null
  try {
    const serialized = JSON.stringify(value)
    if (serialized.length <= 200_000) return value
    return { truncated: true, preview: serialized.slice(0, 200_000), totalCharacters: serialized.length }
  } catch {
    return String(value)
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
