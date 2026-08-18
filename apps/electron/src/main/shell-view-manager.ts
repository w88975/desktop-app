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
  type InstalledAppSummary,
  type ShellState,
  type SurfaceKind,
  type WebviewSurfaceBootstrap,
} from '../shared/app-platform'
import { ShellTabManager, type ShellTabEffect } from './shell-tab-manager'
import type { ExternalAppRegistry } from './external-app-registry'
import { registerExternalAppProtocolForSession } from './external-app-protocol'

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

interface GuestDescriptor {
  kind: 'home' | 'agent' | 'app'
  tabId?: string
  appId?: string
  external?: boolean
  preload: string
}

export class ShellViewManager {
  private readonly window: BrowserWindow
  private readonly workspaceId: string
  private readonly registerSurface: ShellViewManagerOptions['registerSurface']
  private readonly unregisterSurface: ShellViewManagerOptions['unregisterSurface']
  private readonly externalAppRegistry: ExternalAppRegistry
  private readonly unsubscribeExternalApps: () => void
  private readonly managedTabs = new Map<string, ManagedTab>()
  private readonly guestWebContents = new Map<number, WebContents>()
  private readonly pendingGuestDescriptors: GuestDescriptor[] = []
  private readonly queuedAgentCommands: AgentShellCommand[] = []
  private readonly queuedAgentNavigationIntents: AgentNavigationIntent[] = []
  private readonly tabManager: ShellTabManager
  private agentWebContents: WebContents | null = null
  private agentRendererReady = false
  private homeWebContents: WebContents | null = null
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
      externalAppPreload,
    }
  }

  private describeGuest(url: string, partition?: string): GuestDescriptor | null {
    try {
      const parsed = new URL(url)
      const bootstrap = this.getWebviewBootstrap()
      const agentEntry = new URL(bootstrap.agentSrc)
      const appEntry = new URL(bootstrap.appHostSrc)

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
    }

    this.guestWebContents.set(contents.id, contents)
    this.registerSurface(contents.id, descriptor.kind, descriptor.tabId, descriptor.appId)
    this.installGuestGuards(contents, descriptor)
    contents.once('destroyed', () => this.detachGuest(contents.id))

    contents.once('did-finish-load', () => {
      windowLog.info(
        `App-platform surface ready: kind=${descriptor.kind}, wc=${contents.id}, rendererPid=${contents.getOSProcessId()}`
      )
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
        windowLog.error(`Surface renderer gone: kind=${kind}, wc=${contents.id}, reason=${details.reason}`)
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
  }

  private handleResize = (): void => {
    const [contentWidth] = this.window.getContentSize()
    const state = this.tabManager.getState()
    this.tabManager.setAgentPanelWidth(clampAgentPanelWidth(contentWidth, state.agentPanelWidthPx))
    this.emitState()
  }

  getState(): ShellState {
    return this.tabManager.getState()
  }

  getInstalledApps(): InstalledAppSummary[] {
    return this.externalAppRegistry.list().map(record => ({
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

  openApp(appId: string): void {
    const externalRecord = this.externalAppRegistry.get(appId)
    const definition = externalRecord ? this.definitionFromExternal(externalRecord) : null
    if (!definition) throw new Error(`Unknown app: ${appId}`)

    const tabId = randomUUID()
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
  }
}
