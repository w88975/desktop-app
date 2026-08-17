import { shell, type BrowserWindow, type WebContents, type WebPreferences } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { windowLog } from './logger'
import {
  APP_PLATFORM_CHANNELS,
  BUILT_IN_APPS,
  DEFAULT_AGENT_PRESENTATION_STATE,
  clampAgentPanelWidth,
  getDefaultAgentPanelWidth,
  reduceAgentPresentation,
  type AgentMode,
  type AgentPresentationState,
  type AgentShellCommand,
  type AppDefinition,
  type AppTab,
  type ShellState,
  type SurfaceKind,
  type WebviewSurfaceBootstrap,
} from '../shared/app-platform'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

interface ShellViewManagerOptions {
  window: BrowserWindow
  workspaceId: string
  initialAgentMode?: AgentMode | 'hidden'
  registerSurface: (webContentsId: number, kind: Exclude<SurfaceKind, 'shell'>, tabId?: string) => void
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
  preload: string
}

export class ShellViewManager {
  private readonly window: BrowserWindow
  private readonly workspaceId: string
  private readonly registerSurface: ShellViewManagerOptions['registerSurface']
  private readonly unregisterSurface: ShellViewManagerOptions['unregisterSurface']
  private readonly tabs: ManagedTab[] = []
  private readonly guestWebContents = new Map<number, WebContents>()
  private readonly pendingGuestDescriptors: GuestDescriptor[] = []
  private readonly queuedAgentCommands: AgentShellCommand[] = []
  private activeTabId: string | null = null
  private agentWebContents: WebContents | null = null
  private agentRendererReady = false
  private homeWebContents: WebContents | null = null
  private nextPendingWebContentsId = -1
  private agentState: AgentPresentationState
  private destroyed = false

  constructor(options: ShellViewManagerOptions) {
    this.window = options.window
    this.workspaceId = options.workspaceId
    this.registerSurface = options.registerSurface
    this.unregisterSurface = options.unregisterSurface

    const [width] = this.window.getContentSize()
    this.agentState = {
      ...DEFAULT_AGENT_PRESENTATION_STATE,
      panelWidthPx: getDefaultAgentPanelWidth(width),
      visible: options.initialAgentMode !== undefined && options.initialAgentMode !== 'hidden',
      lastMode: options.initialAgentMode === 'full' ? 'full' : 'panel',
    }

    this.window.on('resize', this.handleResize)
  }

  getWebviewBootstrap(): WebviewSurfaceBootstrap {
    const bootstrapPreload = pathToFileURL(join(__dirname, 'bootstrap-preload.cjs')).toString()
    const appHostPreload = pathToFileURL(join(__dirname, 'app-host-preload.cjs')).toString()

    if (VITE_DEV_SERVER_URL) {
      const agent = new URL('/index.html', VITE_DEV_SERVER_URL)
      agent.searchParams.set('workspaceId', this.workspaceId)
      agent.searchParams.set('surface', 'agent')
      return {
        agentSrc: agent.toString(),
        agentPreload: bootstrapPreload,
        appHostSrc: new URL('/app-host.html', VITE_DEV_SERVER_URL).toString(),
        appHostPreload,
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
    }
  }

  private describeGuest(url: string): GuestDescriptor | null {
    try {
      const parsed = new URL(url)
      const bootstrap = this.getWebviewBootstrap()
      const agentEntry = new URL(bootstrap.agentSrc)
      const appEntry = new URL(bootstrap.appHostSrc)

      if (parsed.origin !== agentEntry.origin || parsed.pathname !== agentEntry.pathname) {
        if (parsed.origin !== appEntry.origin || parsed.pathname !== appEntry.pathname) return null
      }

      if (parsed.pathname === agentEntry.pathname && parsed.searchParams.get('surface') === 'agent') {
        if (parsed.searchParams.get('workspaceId') !== this.workspaceId) return null
        return { kind: 'agent', preload: bootstrap.agentPreload }
      }

      if (parsed.pathname !== appEntry.pathname) return null
      const appId = parsed.searchParams.get('appId')
      if (appId === 'home') return { kind: 'home', preload: bootstrap.appHostPreload }

      const tabId = parsed.searchParams.get('tabId') ?? undefined
      const tab = tabId ? this.tabs.find(item => item.tab.id === tabId) : undefined
      if (!tab || tab.definition.id !== appId) return null
      return { kind: 'app', tabId, preload: bootstrap.appHostPreload }
    } catch {
      return null
    }
  }

  authorizeGuest(url: string, webPreferences: WebPreferences): boolean {
    const descriptor = this.describeGuest(url)
    if (!descriptor) return false
    this.pendingGuestDescriptors.push(descriptor)
    webPreferences.preload = fileURLToPath(descriptor.preload)
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
      const tab = this.tabs.find(item => item.tab.id === descriptor.tabId)
      if (!tab || (tab.webContents && !tab.webContents.isDestroyed())) return false
      tab.webContents = contents
      tab.tab.webContentsId = contents.id
    }

    this.guestWebContents.set(contents.id, contents)
    this.registerSurface(contents.id, descriptor.kind, descriptor.tabId)
    this.installGuestGuards(contents, descriptor.kind)
    contents.once('destroyed', () => this.detachGuest(contents.id))

    contents.once('did-finish-load', () => {
      windowLog.info(
        `App-platform surface ready: kind=${descriptor.kind}, wc=${contents.id}, rendererPid=${contents.getOSProcessId()}`
      )
    })

    if (descriptor.kind === 'agent') {
      this.emitAgentPresentation()
    }
    this.emitState()
    return true
  }

  private installGuestGuards(contents: WebContents, kind: GuestDescriptor['kind']): void {
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
    const tab = this.tabs.find(item => item.webContents?.id === webContentsId)
    if (tab) {
      tab.webContents = null
      tab.tab.webContentsId = this.nextPendingWebContentsId--
    }
  }

  private handleResize = (): void => {
    const [contentWidth] = this.window.getContentSize()
    this.agentState = {
      ...this.agentState,
      panelWidthPx: clampAgentPanelWidth(contentWidth, this.agentState.panelWidthPx),
    }
    this.emitState()
  }

  getState(): ShellState {
    return {
      activeTabId: this.activeTabId,
      tabs: this.tabs.map(({ tab }) => ({ ...tab })),
      agent: { ...this.agentState },
    }
  }

  getAgentWebContentsId(): number | undefined {
    return this.agentWebContents?.id
  }

  getAgentWebContents(): WebContents | null {
    return this.agentWebContents
  }

  activateHome(): void {
    this.activeTabId = null
    this.finishContentActivation()
  }

  openApp(appId: string): void {
    const definition = Object.values(BUILT_IN_APPS).find(app => app.id === appId)
    if (!definition) throw new Error(`Unknown built-in app: ${appId}`)

    if (definition.instancePolicy === 'single') {
      const existing = this.tabs.find(item => item.definition.id === appId)
      if (existing) {
        this.activateTab(existing.tab.id)
        return
      }
    }

    const tabId = randomUUID()
    const tab: AppTab = {
      id: tabId,
      appId: definition.id,
      title: definition.title,
      webContentsId: this.nextPendingWebContentsId--,
    }
    this.tabs.push({ tab, definition, webContents: null })
    this.activeTabId = tabId
    this.finishContentActivation()
  }

  activateTab(tabId: string): void {
    if (!this.tabs.some(item => item.tab.id === tabId)) throw new Error(`Unknown app tab: ${tabId}`)
    this.activeTabId = tabId
    this.finishContentActivation()
  }

  private finishContentActivation(): void {
    if (this.agentState.visible && this.agentState.lastMode === 'full') {
      this.agentState = { ...this.agentState, visible: false }
      this.emitAllState()
      return
    }
    this.emitState()
  }

  closeTab(tabId: string): void {
    const index = this.tabs.findIndex(item => item.tab.id === tabId)
    if (index < 0) return
    const [removed] = this.tabs.splice(index, 1)

    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs[index - 1]?.tab.id ?? null
    }
    this.emitState()
    if (removed.webContents && !removed.webContents.isDestroyed()) removed.webContents.close()
  }

  toggleAgent(): void {
    this.agentState = reduceAgentPresentation(this.agentState, { type: 'agent-icon' })
    this.emitAllState()
  }

  toggleAgentMode(): void {
    this.agentState = reduceAgentPresentation(this.agentState, { type: 'header-toggle' })
    this.emitAllState()
  }

  closeAgentPanel(): void {
    if (this.agentState.lastMode !== 'panel') return
    this.agentState = reduceAgentPresentation(this.agentState, { type: 'panel-close' })
    this.emitAllState()
  }

  setPanelWidth(widthPx: number): void {
    const [contentWidth] = this.window.getContentSize()
    this.agentState = {
      ...this.agentState,
      panelWidthPx: clampAgentPanelWidth(contentWidth, widthPx),
    }
    this.emitState()
  }

  sendAgentCommand(command: AgentShellCommand): void {
    if (!this.agentState.visible) {
      this.agentState = { ...this.agentState, visible: true, lastMode: 'full' }
      this.emitAllState()
    }
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
    for (const command of this.queuedAgentCommands.splice(0)) {
      this.agentWebContents.send(APP_PLATFORM_CHANNELS.AGENT_COMMAND_RECEIVED, command)
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
        { ...this.agentState }
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
    for (const contents of this.guestWebContents.values()) {
      if (!contents.isDestroyed()) contents.close()
    }
    this.guestWebContents.clear()
    this.pendingGuestDescriptors.length = 0
    this.tabs.length = 0
    this.agentWebContents = null
    this.agentRendererReady = false
    this.homeWebContents = null
  }
}
