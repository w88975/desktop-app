import React from 'react'
import ReactDOM from 'react-dom/client'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { HuaxiaozhuSymbol } from '@/components/icons/HuaxiaozhuSymbol'
import { MOBILE_PATTERN, VERIFICATION_CODE_PATTERN, type AuthState } from '../shared/auth'
import './index.css'
import './login.css'

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return '请求失败，请稍后重试'
  const marker = 'Error: '
  const index = error.message.lastIndexOf(marker)
  return index >= 0 ? error.message.slice(index + marker.length) : error.message
}

function useSystemTheme() {
  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
}

function LoginForm({ initialState }: { initialState: AuthState }) {
  const [authState, setAuthState] = React.useState(initialState)
  const [phone, setPhone] = React.useState(initialState.user?.phone ?? '')
  const [code, setCode] = React.useState('')
  const [agreement, setAgreement] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [sendError, setSendError] = React.useState('')
  const [loginError, setLoginError] = React.useState('')
  const [agreementMessage, setAgreementMessage] = React.useState('')
  const [now, setNow] = React.useState(Date.now())

  React.useEffect(() => window.authAPI?.onStateChanged(setAuthState), [])
  React.useEffect(() => {
    const deadline = authState.resendAvailableAt
    if (!deadline || deadline <= Date.now()) return
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= deadline) window.clearInterval(timer)
    }, 250)
    return () => window.clearInterval(timer)
  }, [authState.resendAvailableAt])

  const resendSeconds = authState.resendAvailableAt
    ? Math.max(0, Math.ceil((authState.resendAvailableAt - now) / 1000))
    : 0
  const phoneValid = MOBILE_PATTERN.test(phone)
  const codeValid = VERIFICATION_CODE_PATTERN.test(code)
  const loggingIn = authState.status === 'authenticating'

  const sendCode = async () => {
    if (!phoneValid || sending || resendSeconds > 0) return
    setSending(true)
    setSendError('')
    try {
      if (!window.authAPI) throw new Error('认证服务不可用')
      await window.authAPI.sendCode(phone)
      setNow(Date.now())
    } catch (error) {
      setSendError(errorMessage(error))
    } finally {
      setSending(false)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!phoneValid || !codeValid || !agreement || loggingIn) return
    setLoginError('')
    try {
      if (!window.authAPI) throw new Error('认证服务不可用')
      await window.authAPI.login(phone, code)
    } catch (error) {
      setLoginError(errorMessage(error))
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <div className="login-brand">
        <HuaxiaozhuSymbol className="login-brand-symbol" />
        <div>
          <h1>欢迎使用华小竹</h1>
          <p>登录后开始使用</p>
        </div>
      </div>

      <Tabs value="code" className="w-full">
        <TabsList className="login-tabs">
          <TabsTrigger value="password" disabled title="暂未开放">账号密码登录</TabsTrigger>
          <TabsTrigger value="code">验证码登录</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="login-field">
        <Label htmlFor="phone">手机号码</Label>
        <Input
          id="phone"
          autoFocus
          autoComplete="tel"
          inputMode="numeric"
          maxLength={11}
          value={phone}
          onChange={event => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))}
          placeholder="请输入手机号码"
          aria-invalid={phone.length > 0 && !phoneValid}
        />
        <p className="field-help">
          {phone.length > 0 && !phoneValid ? '请输入正确的中国大陆手机号' : '请输入你在机构人事系统预留的手机号码。'}
        </p>
      </div>

      <div className="login-field">
        <Label htmlFor="code">验证码</Label>
        <div className="code-input-wrap">
          <Input
            id="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="请输入 6 位验证码"
          />
          <Button
            type="button"
            variant="ghost"
            className="send-code-button"
            disabled={!phoneValid || sending || resendSeconds > 0}
            onClick={() => void sendCode()}
          >
            {sending ? '发送中' : resendSeconds > 0 ? `${resendSeconds} 秒后重发` : '获取验证码'}
          </Button>
        </div>
        <p className={sendError ? 'field-error' : 'field-help'}>
          {sendError || '验证码有效期很短，请及时完成验证。'}
        </p>
      </div>

      {loginError && <div className="login-error" role="alert">{loginError}</div>}

      <Button
        type="submit"
        size="lg"
        className="login-submit"
        disabled={!phoneValid || !codeValid || !agreement || loggingIn}
      >
        {loggingIn ? <><LoaderCircle className="animate-spin" />登录中</> : <>登录<ArrowRight /></>}
      </Button>

      <label className="agreement-row">
        <input
          type="checkbox"
          checked={agreement}
          onChange={event => setAgreement(event.target.checked)}
        />
        <span>
          登录即表示同意{' '}
          <button
            type="button"
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              setAgreementMessage('协议暂未开放')
            }}
          >
            《华西数医软件产品使用协议》
          </button>
        </span>
      </label>
      {agreementMessage && <p className="agreement-message">{agreementMessage}</p>}
    </form>
  )
}

function LoginApp() {
  useSystemTheme()
  const [state, setState] = React.useState<AuthState | null>(() => window.authAPI ? null : ({
    status: 'unauthenticated',
    user: null,
    resendAvailableAt: null,
  }))

  React.useEffect(() => {
    if (!window.authAPI) return
    void window.authAPI.getState().then(setState)
    return window.authAPI.onStateChanged(setState)
  }, [])

  return (
    <main className="login-page">
      <section className="login-form-pane">
        {(!state || state.status === 'checking') ? (
          <div className="auth-checking">
            <LoaderCircle className="animate-spin" />
            <span>正在验证登录状态…</span>
          </div>
        ) : (
          <LoginForm initialState={state} />
        )}
      </section>
      <aside className="login-hero" aria-hidden="true" />
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LoginApp />
  </React.StrictMode>,
)
