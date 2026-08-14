import { contextBridge } from 'electron'
import type { AppHostAPI } from '../shared/app-platform'

const api: AppHostAPI = Object.freeze({ capabilities: Object.freeze([]) })
contextBridge.exposeInMainWorld('appHostAPI', api)
