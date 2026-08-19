import { ipcRenderer } from 'electron'
import {
  AUTH_CHANNELS,
  type AuthAPI,
  type AuthState,
  type AuthenticatedRequest,
} from '../shared/auth'

export function createAuthAPI(): AuthAPI {
  return Object.freeze({
    getState: () => ipcRenderer.invoke(AUTH_CHANNELS.GET_STATE),
    sendCode: (phone: string) => ipcRenderer.invoke(AUTH_CHANNELS.SEND_CODE, phone),
    login: (phone: string, code: string) => ipcRenderer.invoke(AUTH_CHANNELS.LOGIN, phone, code),
    logout: () => ipcRenderer.invoke(AUTH_CHANNELS.LOGOUT),
    request: (input: AuthenticatedRequest) => ipcRenderer.invoke(AUTH_CHANNELS.REQUEST, input),
    onStateChanged: (callback: (state: AuthState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: AuthState) => callback(state)
      ipcRenderer.on(AUTH_CHANNELS.STATE_CHANGED, listener)
      return () => ipcRenderer.removeListener(AUTH_CHANNELS.STATE_CHANGED, listener)
    },
  })
}
