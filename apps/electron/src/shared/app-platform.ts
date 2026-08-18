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

export interface AppDefinition {
  id: string
  title: string
  entry: string
  instancePolicy: AppInstancePolicy
  capabilities: readonly string[]
}

export interface AppTab {
  id: string
  appId: string
  title: string
  webContentsId: number
}

export interface ShellState {
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
}

export type AgentShellCommand = 'new-session' | 'open-settings' | 'open-shortcuts' | 'toggle-sidebar'

export type AgentNavigationIntent =
  | { type: 'conversation'; sessionId: string }

export const APP_PLATFORM_CHANNELS = {
  GET_STATE: 'app-platform:get-state',
  GET_WEBVIEW_BOOTSTRAP: 'app-platform:get-webview-bootstrap',
  STATE_CHANGED: 'app-platform:state-changed',
  ACTIVATE_HOME: 'app-platform:activate-home',
  OPEN_APP: 'app-platform:open-app',
  ACTIVATE_TAB: 'app-platform:activate-tab',
  CLOSE_TAB: 'app-platform:close-tab',
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
} as const

export interface ShellAPI {
  getState(): Promise<ShellState>
  getWebviewBootstrap(): Promise<WebviewSurfaceBootstrap>
  activateHome(): Promise<void>
  openApp(appId: string): Promise<void>
  activateTab(tabId: string): Promise<void>
  closeTab(tabId: string): Promise<void>
  focusAgentTab(intent?: AgentNavigationIntent): Promise<void>
  toggleAgentPanel(): Promise<void>
  setPanelWidth(widthPx: number): Promise<void>
  sendAgentCommand(command: AgentShellCommand): Promise<void>
  onStateChanged(callback: (state: ShellState) => void): () => void
}

export interface AppHostAPI {
  capabilities: readonly string[]
}

export type SurfaceKind = 'shell' | 'agent' | 'home' | 'app'

export interface SurfaceRegistration {
  webContentsId: number
  shellWebContentsId: number
  workspaceId: string
  kind: SurfaceKind
  tabId?: string
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

export const BUILT_IN_APPS = {
  TODO_PLACEHOLDER: {
    id: 'todo-placeholder',
    title: 'TODO',
    entry: 'app-host.html?appId=todo-placeholder',
    instancePolicy: 'single',
    capabilities: [],
  },
} as const satisfies Record<string, AppDefinition>

declare global {
  interface Window {
    shellAPI: ShellAPI
    appHostAPI: AppHostAPI
  }
}
