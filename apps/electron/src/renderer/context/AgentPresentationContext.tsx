import React from 'react'
import type { AgentNavigationIntent, AgentPresentationState } from '../../shared/app-platform'

const FALLBACK_STATE: AgentPresentationState = {
  presentation: 'full',
  panelWidthPx: 360,
}

interface AgentPresentationContextValue {
  state: AgentPresentationState
  isPanel: boolean
  isFull: boolean
  openFullView(intent?: AgentNavigationIntent): Promise<void>
  dockAsPanel(): Promise<void>
  closePanel(): Promise<void>
}

const AgentPresentationContext = React.createContext<AgentPresentationContextValue>({
  state: FALLBACK_STATE,
  isPanel: false,
  isFull: true,
  openFullView: async () => {},
  dockAsPanel: async () => {},
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
    isPanel: state.presentation === 'panel',
    isFull: state.presentation === 'full',
    openFullView: (intent) => window.electronAPI.focusAgentTab(intent),
    dockAsPanel: () => window.electronAPI.dockAgentAsPanel(),
    closePanel: () => window.electronAPI.toggleAgentPanel(),
  }), [state])

  return <AgentPresentationContext.Provider value={value}>{children}</AgentPresentationContext.Provider>
}

export function useAgentPresentation(): AgentPresentationContextValue {
  return React.useContext(AgentPresentationContext)
}
