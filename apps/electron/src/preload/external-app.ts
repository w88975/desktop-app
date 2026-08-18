import { contextBridge, ipcRenderer } from 'electron'
import { APP_PLATFORM_CHANNELS, type HxsyAppBridge } from '../shared/app-platform'

const bridge: HxsyAppBridge = Object.freeze({
  getAppName: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.EXTERNAL_GET_APP_NAME),
  getAppVersion: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.EXTERNAL_GET_APP_VERSION),
  openAgentPanel: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.EXTERNAL_OPEN_AGENT_PANEL),
})

contextBridge.exposeInMainWorld('hxsyApp', bridge)
