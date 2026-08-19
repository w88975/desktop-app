import type { CredentialManager } from '@craft-agent/shared/credentials'
import { getLastAuthPhone, setLastAuthPhone } from '@craft-agent/shared/config'
import {
  AUTH_API_BASE_URL,
  MOBILE_PATTERN,
  VERIFICATION_CODE_PATTERN,
  type AuthenticatedRequest,
  type AuthenticatedResponse,
  type AuthState,
  type SendCodeResult,
} from '../shared/auth'

interface TokenPayload {
  registered: boolean
  token: string
  expire: number
  refresh_token: string
  refresh_token_expire: number
  attach?: unknown
}

interface ApiEnvelope<T> {
  code: number
  message?: string
  data: T
  trace_id?: string
}

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>
type AuthListener = (state: AuthState) => void
type CredentialStore = Pick<CredentialManager, 'get' | 'set' | 'delete'>
interface AuthPreferences {
  getLastPhone(): string | undefined
  setLastPhone(phone: string): void
}

const AUTH_CREDENTIAL_ID = { type: 'app_auth' as const }
const SMS_COOLDOWN_MS = 60_000

export class AuthError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message)
    this.name = 'AuthError'
  }
}

export class AuthService {
  private state: AuthState
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private refreshPromise: Promise<void> | null = null
  private listeners = new Set<AuthListener>()

  constructor(
    private readonly credentialManager: CredentialStore,
    private readonly fetcher: Fetcher,
    private readonly now: () => number = Date.now,
    private readonly preferences: AuthPreferences = {
      getLastPhone: getLastAuthPhone,
      setLastPhone: setLastAuthPhone,
    },
  ) {
    const phone = this.preferences.getLastPhone()
    this.state = {
      status: 'checking',
      user: phone ? { phone } : null,
      resendAvailableAt: null,
    }
  }

  getState(): AuthState {
    return structuredClone(this.state)
  }

  subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async initialize(): Promise<AuthState> {
    this.setState({ ...this.state, status: 'checking' })
    const stored = await this.credentialManager.get(AUTH_CREDENTIAL_ID)
    if (!stored?.refreshToken) {
      await this.clearSession()
      return this.getState()
    }

    this.accessToken = stored.value
    this.refreshToken = stored.refreshToken
    try {
      await this.refresh()
    } catch {
      await this.clearSession()
    }
    return this.getState()
  }

  async sendCode(phone: string): Promise<SendCodeResult> {
    this.assertPhone(phone)
    const now = this.now()
    if (this.state.resendAvailableAt && this.state.resendAvailableAt > now) {
      throw new AuthError('请稍后再获取验证码')
    }

    await this.requestEnvelope<unknown>('/passport/valid_code/send', {
      method: 'POST',
      body: {
        user_type: 'user',
        client_type: 'desktop',
        channel: 'sms',
        account: phone,
        biz_type: 'login',
      },
    })

    const resendAvailableAt = now + SMS_COOLDOWN_MS
    this.setState({ ...this.state, resendAvailableAt })
    return { resendAvailableAt }
  }

  async login(phone: string, code: string): Promise<AuthState> {
    this.assertPhone(phone)
    if (!VERIFICATION_CODE_PATTERN.test(code)) throw new AuthError('请输入 6 位数字验证码')

    this.setState({ ...this.state, status: 'authenticating' })
    try {
      const data = await this.requestEnvelope<TokenPayload>('/passport/login', {
        method: 'POST',
        body: {
          user_type: 'user',
          client_type: 'desktop',
          username: phone,
          login_type: 'valid_code',
          valid_code: code,
        },
      })
      if (!data.registered) {
        await this.revokeToken(data.token)
        throw new AuthError('账号尚未完成注册，请联系管理员')
      }
      await this.acceptTokens(data, phone)
      return this.getState()
    } catch (error) {
      this.setState({ ...this.state, status: 'unauthenticated' })
      throw error
    }
  }

  async logout(): Promise<void> {
    const token = this.accessToken
    if (token) {
      try {
        await this.fetcher(this.resolveApiUrl('/passport/logout'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, UserType: 'user' },
        })
      } catch {
        // Remote Logout is best-effort; local credentials are always removed.
      }
    }
    await this.clearSession()
  }

  async authenticatedRequest(input: AuthenticatedRequest): Promise<AuthenticatedResponse> {
    this.assertAuthenticatedRequest(input)
    if (this.state.status !== 'authenticated' || !this.accessToken) {
      throw new AuthError('登录状态已失效', 401)
    }

    let response = await this.sendAuthenticated(input)
    let data = await this.parseResponseBody(response)
    if (response.status === 401 || this.getBusinessCode(data) === 401) {
      await this.refresh()
      response = await this.sendAuthenticated(input)
      data = await this.parseResponseBody(response)
      if (response.status === 401 || this.getBusinessCode(data) === 401) {
        await this.clearSession()
        throw new AuthError('登录状态已失效', 401)
      }
    }
    return { status: response.status, ok: response.ok, data }
  }

  private async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise
    if (!this.refreshToken) throw new AuthError('登录状态已失效', 401)

    this.refreshPromise = (async () => {
      const data = await this.requestEnvelope<TokenPayload>('/passport/refresh_token', {
        method: 'POST',
        body: { refresh_token: this.refreshToken },
      })
      if (!data.registered) throw new AuthError('账号尚未完成注册，请联系管理员')
      const phone = this.state.user?.phone ?? this.preferences.getLastPhone()
      if (!phone) throw new AuthError('登录账号信息缺失')
      await this.acceptTokens(data, phone)
    })()

    try {
      await this.refreshPromise
    } catch (error) {
      await this.clearSession()
      throw error
    } finally {
      this.refreshPromise = null
    }
  }

  private async acceptTokens(data: TokenPayload, phone: string): Promise<void> {
    if (!data.token || !data.refresh_token) throw new AuthError('登录响应缺少令牌')
    this.accessToken = data.token
    this.refreshToken = data.refresh_token
    await this.credentialManager.set(AUTH_CREDENTIAL_ID, {
      value: data.token,
      refreshToken: data.refresh_token,
      expiresAt: data.expire * 1000,
      refreshTokenExpiresAt: data.refresh_token_expire * 1000,
      tokenType: 'Bearer',
    })
    this.preferences.setLastPhone(phone)
    this.setState({ status: 'authenticated', user: { phone }, resendAvailableAt: null })
  }

  private async clearSession(): Promise<void> {
    this.accessToken = null
    this.refreshToken = null
    await this.credentialManager.delete(AUTH_CREDENTIAL_ID)
    this.setState({
      status: 'unauthenticated',
      user: this.preferences.getLastPhone() ? { phone: this.preferences.getLastPhone()! } : null,
      resendAvailableAt: null,
    })
  }

  private async sendAuthenticated(input: AuthenticatedRequest): Promise<Response> {
    if (!this.accessToken) throw new AuthError('登录状态已失效', 401)
    return this.fetcher(this.resolveApiUrl(input.path), {
      method: input.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...input.headers,
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
  }

  private async revokeToken(token: string): Promise<void> {
    if (!token) return
    try {
      await this.fetcher(this.resolveApiUrl('/passport/logout'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, UserType: 'user' },
      })
    } catch {
      // Registration rejection still discards local tokens if revocation fails.
    }
  }

  private async requestEnvelope<T>(path: string, input: { method: string; body?: unknown }): Promise<T> {
    const response = await this.fetcher(this.resolveApiUrl(path), {
      method: input.method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
    const payload = await this.parseResponseBody(response) as Partial<ApiEnvelope<T>> | null
    if (!response.ok || !payload || payload.code !== 200) {
      throw new AuthError(payload?.message || '请求失败，请稍后重试', payload?.code ?? response.status)
    }
    return payload.data as T
  }

  private resolveApiUrl(path: string): string {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
      throw new AuthError('无效的 API 路径')
    }
    const base = new URL(`${AUTH_API_BASE_URL}/`)
    const resolved = new URL(`.${path}`, base)
    const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`
    if (resolved.origin !== base.origin || !resolved.pathname.startsWith(basePath)) {
      throw new AuthError('无效的 API 路径')
    }
    return resolved.toString()
  }

  private async parseResponseBody(response: Response): Promise<unknown> {
    const text = await response.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  private getBusinessCode(data: unknown): number | undefined {
    if (!data || typeof data !== 'object' || !('code' in data)) return undefined
    return typeof data.code === 'number' ? data.code : undefined
  }

  private assertPhone(phone: string): void {
    if (!MOBILE_PATTERN.test(phone)) throw new AuthError('请输入正确的中国大陆手机号')
  }

  private assertAuthenticatedRequest(input: AuthenticatedRequest): void {
    if (!input || typeof input !== 'object' || typeof input.path !== 'string') {
      throw new AuthError('无效的认证请求')
    }
    const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
    if (input.method && !allowedMethods.has(input.method)) {
      throw new AuthError('无效的请求方法')
    }
    if (input.headers && Object.entries(input.headers).some(([key, value]) => !key || typeof value !== 'string')) {
      throw new AuthError('无效的请求头')
    }
  }

  private setState(state: AuthState): void {
    this.state = state
    const snapshot = this.getState()
    for (const listener of this.listeners) listener(snapshot)
  }
}
