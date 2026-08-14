import React from 'react'
import type { AgentPresentationState } from '../../shared/app-platform'

const FALLBACK_STATE: AgentPresentationState = {
  visible: true,
  lastMode: 'full',
  panelWidthPx: 360,
}

interface AgentPresentationContextValue {
  state: AgentPresentationState
  isPanel: boolean
  isFull: boolean
  toggleMode(): Promise<void>
  closePanel(): Promise<void>
}

const AgentPresentationContext = React.createContext<AgentPresentationContextValue>({
  state: FALLBACK_STATE,
  isPanel: false,
  isFull: true,
  toggleMode: async () => {},
  closePanel: async () => {},
})

export function AgentPresentationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState(FALLBACK_STATE)

  React.useEffect(() => {
    const api = window.electronAPI
    if (!api?.getAgentPresentationState) return
    void api.getAgentPresentationState().then(setState)
    return api.onAgentPresentationChanged(setState)
  }, [])

  const value = React.useMemo<AgentPresentationContextValue>(() => ({
    state,
    isPanel: state.lastMode === 'panel',
    isFull: state.lastMode === 'full',
    toggleMode: () => window.electronAPI.toggleAgentPresentationMode(),
    closePanel: () => window.electronAPI.closeAgentPanel(),
  }), [state])

  return <AgentPresentationContext.Provider value={value}>{children}</AgentPresentationContext.Provider>
}

export function useAgentPresentation(): AgentPresentationContextValue {
  return React.useContext(AgentPresentationContext)
}
