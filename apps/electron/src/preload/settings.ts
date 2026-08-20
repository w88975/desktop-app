import './bootstrap'
import { contextBridge, ipcRenderer } from 'electron'
import {
  APP_PLATFORM_CHANNELS,
  type SettingsAppAPI,
  type SettingsAppContext,
} from '../shared/app-platform'

const api: SettingsAppAPI = {
  getContext: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.SETTINGS_GET_CONTEXT),
  setActiveSubpage: subpage => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.SETTINGS_SET_SUBPAGE, subpage),
  notifyReady: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.SETTINGS_RENDERER_READY),
  openAgentConversation: sessionId => ipcRenderer.invoke(
    APP_PLATFORM_CHANNELS.SETTINGS_OPEN_AGENT_CONVERSATION,
    sessionId,
  ),
  onContextChanged: callback => {
    const listener = (_event: Electron.IpcRendererEvent, context: SettingsAppContext) => callback(context)
    ipcRenderer.on(APP_PLATFORM_CHANNELS.SETTINGS_CONTEXT_CHANGED, listener)
    return () => ipcRenderer.removeListener(APP_PLATFORM_CHANNELS.SETTINGS_CONTEXT_CHANGED, listener)
  },
  onNavigate: callback => {
    const listener = (_event: Electron.IpcRendererEvent, subpage: string) => callback(subpage)
    ipcRenderer.on(APP_PLATFORM_CHANNELS.SETTINGS_NAVIGATE, listener)
    return () => ipcRenderer.removeListener(APP_PLATFORM_CHANNELS.SETTINGS_NAVIGATE, listener)
  },
}

contextBridge.exposeInMainWorld('settingsAppAPI', api)
