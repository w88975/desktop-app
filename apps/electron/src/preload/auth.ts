import { contextBridge } from 'electron'
import { createAuthAPI } from './auth-bridge'

contextBridge.exposeInMainWorld('authAPI', createAuthAPI())
