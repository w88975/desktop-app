export type AgentPresentation = 'hidden' | 'panel' | 'full'

export interface AgentPresentationState {
  presentation: AgentPresentation
  panelWidthPx: number
}

export type ActiveTarget =
  | { kind: 'home' }
  | { kind: 'app'; tabId: string }
  | { kind: 'agent' }

export type AppInstancePolicy = 'single' | 'multiple'
export type AppKind = 'built-in' | 'external' | 'internal' | 'browser'
export type ExternalAppSourceType = 'builtin' | 'local' | 'remote'
export type ExternalAppStatus = 'discovered' | 'loading' | 'ready' | 'error'

export interface ExternalWebToolManifest {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: string
}

export interface ExternalWebToolInvokeRequest {
  callId: string
  handler: string
  arguments: Record<string, unknown>
}

export interface ExternalWebToolResult {
  callId: string
  ok: boolean
  result?: unknown
  error?: string
}

export interface ExternalAppManifest {
  schemaVersion: 1
  appId: string
  title: string
  icon: string
  entry: string
  version?: string
  description?: string
  webTools?: ExternalWebToolManifest[]
}

export interface ExternalAppRecord {
  appId: string
  sourceType: ExternalAppSourceType
  status: ExternalAppStatus
  title: string
  description?: string
  version?: string
  iconUrl?: string
  entryUrl?: string
  error?: string
  webTools: ExternalWebToolManifest[]
}

export interface InstalledAppSummary {
  appId: string
  kind: AppKind
  sourceType?: ExternalAppSourceType
  status: ExternalAppStatus
  title: string
  description?: string
  version?: string
  iconUrl?: string
  error?: string
  webTools: ExternalWebToolManifest[]
}

export interface AppDefinition {
  id: string
  title: string
  entry: string
  kind: AppKind
  instancePolicy: AppInstancePolicy
  capabilities: readonly string[]
  iconUrl?: string
  status?: ExternalAppStatus
  error?: string
  partition?: string
  browserInstanceId?: string
}

export interface BrowserTabState {
  url: string
  title: string
  favicon: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  agentControlLabel?: string
  viewportWidth?: number
  viewportHeight?: number
}

export interface AppTab {
  id: string
  appId: string
  title: string
  webContentsId: number
  kind: AppKind
  entry: string
  iconUrl?: string
  status: ExternalAppStatus
  error?: string
  partition?: string
  browserInstanceId?: string
  browserState?: BrowserTabState
}

export interface ShellState {
  /** Present on the Shell projection; omitted by the pure tab state manager. */
  workspaceId?: string
  activeTarget: ActiveTarget
  tabs: AppTab[]
  agentPanelVisible: boolean
  previousContentTabId: string | null
  agentPanelWidthPx: number
}

export interface WebviewSurfaceBootstrap {
  agentSrc: string
  agentPreload: string
  appHostSrc: string
  appHostPreload: string
  settingsSrc: string
  settingsPreload: string
  externalAppPreload: string
}

export type AgentShellCommand = 'new-session' | 'toggle-sidebar'

export type AgentNavigationIntent =
  | { type: 'conversation'; sessionId: string }

export const APP_PLATFORM_CHANNELS = {
  GET_STATE: 'app-platform:get-state',
  GET_WEBVIEW_BOOTSTRAP: 'app-platform:get-webview-bootstrap',
  STATE_CHANGED: 'app-platform:state-changed',
  ACTIVATE_HOME: 'app-platform:activate-home',
  OPEN_APP: 'app-platform:open-app',
  OPEN_SETTINGS: 'app-platform:open-settings',
  ACTIVATE_TAB: 'app-platform:activate-tab',
  CLOSE_TAB: 'app-platform:close-tab',
  REORDER_TAB: 'app-platform:reorder-tab',
  SET_TAB_ORDER: 'app-platform:set-tab-order',
  CLOSE_TABS_RIGHT: 'app-platform:close-tabs-right',
  CLOSE_OTHER_TABS: 'app-platform:close-other-tabs',
  TOGGLE_AGENT_PANEL: 'app-platform:toggle-agent-panel',
  FOCUS_AGENT_TAB: 'app-platform:focus-agent-tab',
  UNFOCUS_AGENT_TAB: 'app-platform:unfocus-agent-tab',
  DOCK_AGENT_AS_PANEL: 'app-platform:dock-agent-as-panel',
  SET_PANEL_WIDTH: 'app-platform:set-panel-width',
  AGENT_PRESENTATION_CHANGED: 'app-platform:agent-presentation-changed',
  AGENT_COMMAND: 'app-platform:agent-command',
  AGENT_COMMAND_RECEIVED: 'app-platform:agent-command-received',
  AGENT_NAVIGATION_INTENT_RECEIVED: 'app-platform:agent-navigation-intent-received',
  AGENT_RENDERER_READY: 'app-platform:agent-renderer-ready',
  LIST_INSTALLED_APPS: 'app-platform:list-installed-apps',
  OPEN_APPS_DIRECTORY: 'app-platform:open-apps-directory',
  RESCAN_EXTERNAL_APPS: 'app-platform:rescan-external-apps',
  RETRY_EXTERNAL_APP: 'app-platform:retry-external-app',
  INSTALLED_APPS_CHANGED: 'app-platform:installed-apps-changed',
  EXTERNAL_GET_APP_NAME: 'app-platform:external-get-app-name',
  EXTERNAL_GET_APP_VERSION: 'app-platform:external-get-app-version',
  EXTERNAL_OPEN_AGENT_PANEL: 'app-platform:external-open-agent-panel',
  EXTERNAL_WEB_TOOL_INVOKE: 'app-platform:external-web-tool-invoke',
  EXTERNAL_WEB_TOOL_RESULT: 'app-platform:external-web-tool-result',
  EXTERNAL_WEB_TOOL_REGISTERED: 'app-platform:external-web-tool-registered',
  SETTINGS_GET_CONTEXT: 'app-platform:settings-get-context',
  SETTINGS_CONTEXT_CHANGED: 'app-platform:settings-context-changed',
  SETTINGS_NAVIGATE: 'app-platform:settings-navigate',
  SETTINGS_SET_SUBPAGE: 'app-platform:settings-set-subpage',
  SETTINGS_RENDERER_READY: 'app-platform:settings-renderer-ready',
  SETTINGS_OPEN_AGENT_CONVERSATION: 'app-platform:settings-open-agent-conversation',
  THEME_PREFERENCES_CHANGED: 'app-platform:theme-preferences-changed',
  WORKSPACE_THEME_CHANGED: 'app-platform:workspace-theme-changed',
} as const

export interface ShellAPI {
  getState(): Promise<ShellState>
  getWebviewBootstrap(): Promise<WebviewSurfaceBootstrap>
  activateHome(): Promise<void>
  openApp(appId: string): Promise<void>
  openSettings(subpage?: string): Promise<void>
  activateTab(tabId: string): Promise<void>
  closeTab(tabId: string): Promise<void>
  reorderTab(tabId: string, targetTabId: string, placement: 'before' | 'after'): Promise<void>
  setTabOrder(tabIds: string[]): Promise<void>
  closeTabsRight(tabId: string): Promise<void>
  closeOtherTabs(tabId: string): Promise<void>
  focusAgentTab(intent?: AgentNavigationIntent): Promise<void>
  toggleAgentPanel(): Promise<void>
  retryExternalApp(appId: string): Promise<void>
  setPanelWidth(widthPx: number): Promise<void>
  sendAgentCommand(command: AgentShellCommand): Promise<void>
  onStateChanged(callback: (state: ShellState) => void): () => void
}

export interface AppHostAPI {
  capabilities: readonly string[]
  listInstalledApps(): Promise<InstalledAppSummary[]>
  openInstalledApp(appId: string): Promise<void>
  retryExternalApp(appId: string): Promise<void>
  openAppsDirectory(): Promise<void>
  rescanExternalApps(): Promise<void>
  onInstalledAppsChanged(callback: (apps: InstalledAppSummary[]) => void): () => void
}

export interface HxsyAppBridge {
  getAppName(): Promise<string>
  getAppVersion(): Promise<string>
  openAgentPanel(): Promise<void>
}

export type AgentWebToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>

export interface AgentToolsRegistry {
  [handler: string]: AgentWebToolHandler
}

export interface AgentAppBridge {
  tools: AgentToolsRegistry
}

/**
 * Runs in the app page's main world via contextBridge.executeInMainWorld().
 * Keep self-contained: Electron serializes this function and cannot preserve closures.
 */
export function installAgentToolsMainWorldBridge(): void {
  const handlers = new Map<string, (args: Record<string, unknown>) => unknown | Promise<unknown>>()
  const tools = new Proxy(Object.create(null) as Record<string, unknown>, {
    get: (_target, property) => typeof property === 'string' ? handlers.get(property) : undefined,
    set: (_target, property, value) => {
      if (typeof property !== 'string' || typeof value !== 'function') {
        throw new TypeError('window.agent.tools handlers must be functions')
      }
      handlers.set(property, value as (args: Record<string, unknown>) => unknown | Promise<unknown>)
      window.dispatchEvent(new CustomEvent('hxsy-agent-webtool-registered', { detail: property }))
      return true
    },
    ownKeys: () => [...handlers.keys()],
    getOwnPropertyDescriptor: (_target, property) => typeof property === 'string' && handlers.has(property)
      ? { configurable: true, enumerable: true }
      : undefined,
  })

  Object.defineProperty(window, 'agent', {
    value: Object.freeze({ tools }),
    configurable: false,
    enumerable: true,
    writable: false,
  })

  window.addEventListener('hxsy-agent-webtool-invoke', (event) => {
    const detail = (event as CustomEvent<string>).detail
    void (async () => {
      let callId = 'unknown'
      try {
        const request = JSON.parse(detail) as ExternalWebToolInvokeRequest
        callId = request.callId
        const handler = handlers.get(request.handler)
        if (!handler) throw new Error(`WebTool handler not registered: ${request.handler}`)
        const result = await handler(request.arguments)
        const serialized = JSON.stringify({ callId, ok: true, result: result ?? null })
        if (serialized.length > 1_000_000) throw new Error('WebTool result exceeded 1MB')
        window.dispatchEvent(new CustomEvent('hxsy-agent-webtool-result', {
          detail: serialized,
        }))
      } catch (error) {
        window.dispatchEvent(new CustomEvent('hxsy-agent-webtool-result', {
          detail: JSON.stringify({
            callId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        }))
      }
    })()
  })
}

export interface SettingsAppContext {
  workspaceId: string
}

export interface SettingsAppAPI {
  getContext(): Promise<SettingsAppContext>
  setActiveSubpage(subpage: string): Promise<void>
  notifyReady(): Promise<void>
  openAgentConversation(sessionId: string): Promise<void>
  onContextChanged(callback: (context: SettingsAppContext) => void): () => void
  onNavigate(callback: (subpage: string) => void): () => void
}

export type SurfaceKind = 'shell' | 'agent' | 'home' | 'app'

export interface SurfaceRegistration {
  webContentsId: number
  shellWebContentsId: number
  workspaceId: string
  kind: SurfaceKind
  tabId?: string
  appId?: string
}

export const AGENT_PANEL_DEFAULT_RATIO = 0.4
export const AGENT_PANEL_MAX_RATIO = 0.7
export const AGENT_PANEL_MIN_WIDTH_PX = 360
export const APP_SURFACE_MIN_WIDTH_PX = 360

export function deriveAgentPresentationState(state: ShellState): AgentPresentationState {
  return {
    presentation: state.activeTarget.kind === 'agent'
      ? 'full'
      : state.agentPanelVisible ? 'panel' : 'hidden',
    panelWidthPx: state.agentPanelWidthPx,
  }
}

export function getActiveContentTabId(state: ShellState): string | null {
  if (state.activeTarget.kind === 'app') return state.activeTarget.tabId
  if (state.activeTarget.kind === 'agent') return state.previousContentTabId
  return null
}

export function clampAgentPanelWidth(contentWidthPx: number, requestedWidthPx: number): number {
  const maxRatioPercent = Math.round(AGENT_PANEL_MAX_RATIO * 100)
  const maxByRatio = Math.floor((contentWidthPx * maxRatioPercent) / 100)
  const maxByAppWidth = contentWidthPx - APP_SURFACE_MIN_WIDTH_PX
  const maximum = Math.max(
    AGENT_PANEL_MIN_WIDTH_PX,
    Math.min(maxByRatio, maxByAppWidth)
  )
  return Math.min(maximum, Math.max(AGENT_PANEL_MIN_WIDTH_PX, Math.round(requestedWidthPx)))
}

export function getDefaultAgentPanelWidth(contentWidthPx: number): number {
  return clampAgentPanelWidth(contentWidthPx, contentWidthPx * AGENT_PANEL_DEFAULT_RATIO)
}

declare global {
  interface Window {
    shellAPI: ShellAPI
    appHostAPI: AppHostAPI
    hxsyApp: HxsyAppBridge
    agent: AgentAppBridge
    settingsAppAPI: SettingsAppAPI
  }
}
