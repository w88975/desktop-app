import { contextBridge, ipcRenderer } from 'electron'
import {
  APP_PLATFORM_CHANNELS,
  installAgentToolsMainWorldBridge,
  type ExternalWebToolInvokeRequest,
  type ExternalWebToolResult,
  type HxsyAppBridge,
} from '../shared/app-platform'

const bridge: HxsyAppBridge = Object.freeze({
  getAppName: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.EXTERNAL_GET_APP_NAME),
  getAppVersion: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.EXTERNAL_GET_APP_VERSION),
  openAgentPanel: () => ipcRenderer.invoke(APP_PLATFORM_CHANNELS.EXTERNAL_OPEN_AGENT_PANEL),
})

contextBridge.exposeInMainWorld('hxsyApp', bridge)

contextBridge.executeInMainWorld({ func: installAgentToolsMainWorldBridge })

window.addEventListener('hxsy-agent-webtool-registered', (event) => {
  const handler = (event as CustomEvent<string>).detail
  if (typeof handler === 'string' && handler) {
    ipcRenderer.send(APP_PLATFORM_CHANNELS.EXTERNAL_WEB_TOOL_REGISTERED, { handler })
  }
})

window.addEventListener('hxsy-agent-webtool-result', (event) => {
  const raw = (event as CustomEvent<string>).detail
  if (typeof raw !== 'string') return
  try {
    ipcRenderer.send(
      APP_PLATFORM_CHANNELS.EXTERNAL_WEB_TOOL_RESULT,
      JSON.parse(raw) as ExternalWebToolResult,
    )
  } catch {
    // Ignore malformed page-world bridge messages.
  }
})

ipcRenderer.on(
  APP_PLATFORM_CHANNELS.EXTERNAL_WEB_TOOL_INVOKE,
  (_event, request: ExternalWebToolInvokeRequest) => {
    window.dispatchEvent(new CustomEvent('hxsy-agent-webtool-invoke', {
      detail: JSON.stringify(request),
    }))
  },
)
