export const AUTH_API_BASE_URL = 'https://api-aidp.hxsyai.com/v1'

export type AuthStatus = 'checking' | 'unauthenticated' | 'authenticating' | 'authenticated'

export interface AuthUser {
  phone: string
}

export interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  resendAvailableAt: number | null
}

export interface AuthenticatedRequest {
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
}

export interface AuthenticatedResponse {
  status: number
  ok: boolean
  data: unknown
}

export interface SendCodeResult {
  resendAvailableAt: number
}

export interface AuthAPI {
  getState(): Promise<AuthState>
  sendCode(phone: string): Promise<SendCodeResult>
  login(phone: string, code: string): Promise<AuthState>
  logout(): Promise<void>
  request(input: AuthenticatedRequest): Promise<AuthenticatedResponse>
  onStateChanged(callback: (state: AuthState) => void): () => void
}

export const AUTH_CHANNELS = {
  GET_STATE: 'auth:get-state',
  SEND_CODE: 'auth:send-code',
  LOGIN: 'auth:login',
  LOGOUT: 'auth:logout',
  REQUEST: 'auth:request',
  STATE_CHANGED: 'auth:state-changed',
} as const

export const MOBILE_PATTERN = /^1[3-9]\d{9}$/
export const VERIFICATION_CODE_PATTERN = /^\d{6}$/

declare global {
  interface Window {
    authAPI: AuthAPI
  }
}
