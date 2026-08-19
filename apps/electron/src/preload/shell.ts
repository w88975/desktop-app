import { contextBridge, ipcRenderer } from 'electron'
import {
  APP_PLATFORM_CHANNELS,
  type AgentShellCommand,
  type ShellAPI,
  type ShellState,
  type WebviewSurfaceBootstrap,
} from '../shared/app-platform'
import { createAuthAPI } from './auth-bridge'

const api: ShellAPI = {
  getState: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.GET_STATE),
  getWebviewBootstrap: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.GET_WEBVIEW_BOOTSTRAP) as Promise<WebviewSurfaceBootstrap>,
  activateHome: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.ACTIVATE_HOME),
  openApp: (appId) => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.OPEN_APP, appId),
  activateTab: (tabId) => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.ACTIVATE_TAB, tabId),
  closeTab: (tabId) => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.CLOSE_TAB, tabId),
  focusAgentTab: (intent) => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.FOCUS_AGENT_TAB, intent),
  toggleAgentPanel: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.TOGGLE_AGENT_PANEL),
  retryExternalApp: (appId) => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.RETRY_EXTERNAL_APP, appId),
  setPanelWidth: (widthPx) => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.SET_PANEL_WIDTH, widthPx),
  sendAgentCommand: (command: AgentShellCommand) => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.AGENT_COMMAND, command),
  onStateChanged: (callback: (state: ShellState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ShellState) => callback(state)
    ipcRenderer.on(APP_PLATFORM_CHANNELS.STATE_CHANGED, listener)
    return () => ipcRenderer.removeListener(APP_PLATFORM_CHANNELS.STATE_CHANGED, listener)
  },
}

contextBridge.exposeInMainWorld('shellAPI', api)
contextBridge.exposeInMainWorld('authAPI', createAuthAPI())
