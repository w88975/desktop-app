import { contextBridge, ipcRenderer } from 'electron'
import {
  APP_PLATFORM_CHANNELS,
  type AppHostAPI,
  type InstalledAppSummary,
} from '../shared/app-platform'

const api: AppHostAPI = Object.freeze({
  capabilities: Object.freeze([]),
  listInstalledApps: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.LIST_INSTALLED_APPS),
  openInstalledApp: (appId: string) => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.OPEN_APP, appId),
  retryExternalApp: (appId: string) => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.RETRY_EXTERNAL_APP, appId),
  openAppsDirectory: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.OPEN_APPS_DIRECTORY),
  rescanExternalApps: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.RESCAN_EXTERNAL_APPS),
  onInstalledAppsChanged: (callback: (apps: InstalledAppSummary[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, apps: InstalledAppSummary[]) => callback(apps)
    ipcRenderer.on(APP_PLATFORM_CHANNELS.INSTALLED_APPS_CHANGED, listener)
    return () => ipcRenderer.removeListener(APP_PLATFORM_CHANNELS.INSTALLED_APPS_CHANGED, listener)
  },
})
contextBridge.exposeInMainWorld('appHostAPI', api)
