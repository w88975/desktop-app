import { describe, expect, it } from 'bun:test'
import type { StoredCredential } from '@craft-agent/shared/credentials'
import { AuthService } from '../auth-service'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function tokenEnvelope(token = 'access-1', refreshToken = 'refresh-1') {
  return {
    code: 200,
    message: 'success',
    data: {
      registered: true,
      token,
      expire: 1_800_000_000,
      refresh_token: refreshToken,
      refresh_token_expire: 1_900_000_000,
      attach: {},
    },
  }
}

function createHarness(options?: { stored?: StoredCredential | null; phone?: string; now?: number }) {
  let stored = options?.stored ?? null
  let phone = options?.phone
  let now = options?.now ?? 1_000
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const responses: Response[] = []
  const credentials = {
    get: async () => stored,
    set: async (_id: unknown, value: StoredCredential) => { stored = value },
    delete: async () => { const existed = stored !== null; stored = null; return existed },
  }
  const fetcher = async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const response = responses.shift()
    if (!response) throw new Error('Missing test response')
    return response
  }
  const service = new AuthService(credentials, fetcher, () => now, {
    getLastPhone: () => phone,
    setLastPhone: value => { phone = value },
  })
  return {
    service,
    calls,
    responses,
    getStored: () => stored,
    getPhone: () => phone,
    setNow: (value: number) => { now = value },
  }
}

describe('AuthService', () => {
  it('starts unauthenticated without a stored refresh token', async () => {
    const harness = createHarness()

    await harness.service.initialize()

    expect(harness.service.getState()).toEqual({
      status: 'unauthenticated',
      user: null,
      resendAvailableAt: null,
    })
    expect(harness.calls).toHaveLength(0)
  })

  it('always refreshes stored credentials at startup', async () => {
    const harness = createHarness({
      stored: { value: 'old-access', refreshToken: 'old-refresh' },
      phone: '13800138000',
    })
    harness.responses.push(json(tokenEnvelope('new-access', 'new-refresh')))

    await harness.service.initialize()

    expect(harness.calls[0]?.url).toBe('https://api-aidp.hxsyai.com/v1/passport/refresh_token')
    expect(JSON.parse(String(harness.calls[0]?.init?.body))).toEqual({ refresh_token: 'old-refresh' })
    expect(harness.service.getState().status).toBe('authenticated')
    expect(harness.getStored()).toMatchObject({ value: 'new-access', refreshToken: 'new-refresh' })
  })

  it('clears credentials when startup refresh fails', async () => {
    const harness = createHarness({
      stored: { value: 'old-access', refreshToken: 'old-refresh' },
      phone: '13800138000',
    })
    harness.responses.push(json({ code: 401, message: '登录已过期', data: {} }, 401))

    await harness.service.initialize()

    expect(harness.service.getState().status).toBe('unauthenticated')
    expect(harness.getStored()).toBeNull()
  })

  it('enforces a process-wide 60 second SMS cooldown after success', async () => {
    const harness = createHarness({ now: 10_000 })
    harness.responses.push(json({ code: 200, message: 'success', data: {} }))

    const result = await harness.service.sendCode('13800138000')

    expect(result.resendAvailableAt).toBe(70_000)
    expect(harness.service.getState().resendAvailableAt).toBe(70_000)
    await expect(harness.service.sendCode('13800138000')).rejects.toThrow('请稍后再获取验证码')
    expect(harness.calls).toHaveLength(1)

    harness.setNow(70_000)
    harness.responses.push(json({ code: 200, message: 'success', data: {} }))
    await expect(harness.service.sendCode('13800138000')).resolves.toEqual({ resendAvailableAt: 130_000 })
  })

  it('logs in with fixed Desktop verification-code fields', async () => {
    const harness = createHarness()
    harness.responses.push(json(tokenEnvelope()))

    await harness.service.login('13800138000', '123456')

    expect(JSON.parse(String(harness.calls[0]?.init?.body))).toEqual({
      user_type: 'user',
      client_type: 'desktop',
      username: '13800138000',
      login_type: 'valid_code',
      valid_code: '123456',
    })
    expect(harness.getPhone()).toBe('13800138000')
    expect(harness.service.getState()).toMatchObject({
      status: 'authenticated',
      user: { phone: '13800138000' },
    })
  })

  it('rejects unregistered users and revokes returned access token', async () => {
    const harness = createHarness()
    const payload = tokenEnvelope()
    payload.data.registered = false
    harness.responses.push(json(payload), json({ code: 200, data: {} }))

    await expect(harness.service.login('13800138000', '123456')).rejects.toThrow('账号尚未完成注册')

    expect(harness.calls[1]?.url).toContain('/passport/logout')
    expect((harness.calls[1]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer access-1')
    expect(harness.getStored()).toBeNull()
  })

  it('refreshes after 401 and retries an authenticated request once', async () => {
    const harness = createHarness()
    harness.responses.push(
      json(tokenEnvelope('access-1', 'refresh-1')),
      json({ code: 401, message: '登录已过期', data: {} }, 401),
      json(tokenEnvelope('access-2', 'refresh-2')),
      json({ code: 200, data: { ok: true } }),
    )
    await harness.service.login('13800138000', '123456')

    const response = await harness.service.authenticatedRequest({ path: '/profile', method: 'GET' })

    expect(response).toEqual({ status: 200, ok: true, data: { code: 200, data: { ok: true } } })
    expect(harness.calls.map(call => call.url)).toEqual([
      'https://api-aidp.hxsyai.com/v1/passport/login',
      'https://api-aidp.hxsyai.com/v1/profile',
      'https://api-aidp.hxsyai.com/v1/passport/refresh_token',
      'https://api-aidp.hxsyai.com/v1/profile',
    ])
    expect((harness.calls[3]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer access-2')
  })

  it('rejects absolute and root-escaping authenticated request paths', async () => {
    const harness = createHarness()
    harness.responses.push(json(tokenEnvelope()))
    await harness.service.login('13800138000', '123456')

    await expect(harness.service.authenticatedRequest({ path: 'https://evil.example/token' })).rejects.toThrow('无效的 API 路径')
    await expect(harness.service.authenticatedRequest({ path: '/../token' })).rejects.toThrow('无效的 API 路径')
  })
})
