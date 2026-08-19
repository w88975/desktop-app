import React from 'react'
import type {
  AuthenticatedRequest,
  AuthenticatedResponse,
  AuthState,
} from '../../shared/auth'

interface AuthContextValue {
  state: AuthState
  logout(): Promise<void>
  request(input: AuthenticatedRequest): Promise<AuthenticatedResponse>
}

const INITIAL_STATE: AuthState = {
  status: 'checking',
  user: null,
  resendAvailableAt: null,
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState(INITIAL_STATE)

  React.useEffect(() => {
    void window.authAPI.getState().then(setState)
    return window.authAPI.onStateChanged(setState)
  }, [])

  const value = React.useMemo<AuthContextValue>(() => ({
    state,
    logout: () => window.authAPI.logout(),
    request: input => window.authAPI.request(input),
  }), [state])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
