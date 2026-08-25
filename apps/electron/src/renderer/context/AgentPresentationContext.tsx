import React from 'react'
import type { AgentNavigationIntent, AgentPresentation, AgentPresentationState } from '../../shared/app-platform'

const FALLBACK_STATE: AgentPresentationState = {
  presentation: 'full',
  panelWidthPx: 360,
}

interface AgentPresentationContextValue {
  state: AgentPresentationState
  isPanel: boolean
  isFull: boolean
  openFullView(intent?: AgentNavigationIntent): Promise<void>
  dockAsPanel(intent?: AgentNavigationIntent): Promise<void>
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

export function AgentPresentationProvider({
  children,
  forcePresentation,
}: {
  children: React.ReactNode
  forcePresentation?: AgentPresentation
}) {
  const [state, setState] = React.useState(FALLBACK_STATE)

  React.useEffect(() => {
    const api = window.electronAPI
    if (!api?.getAgentPresentationState) return
    void api.getAgentPresentationState().then(setState)
    return api.onAgentPresentationChanged(setState)
  }, [])

  const effectiveState = React.useMemo<AgentPresentationState>(() => forcePresentation
    ? { ...state, presentation: forcePresentation }
    : state, [forcePresentation, state])

  const value = React.useMemo<AgentPresentationContextValue>(() => ({
    state: effectiveState,
    isPanel: effectiveState.presentation === 'panel',
    isFull: effectiveState.presentation === 'full',
    openFullView: (intent) => window.electronAPI.focusAgentTab(intent),
    dockAsPanel: (intent) => window.electronAPI.dockAgentAsPanel(intent),
    closePanel: () => window.electronAPI.toggleAgentPanel(),
  }), [effectiveState])

  return <AgentPresentationContext.Provider value={value}>{children}</AgentPresentationContext.Provider>
}

export function useAgentPresentation(): AgentPresentationContextValue {
  return React.useContext(AgentPresentationContext)
}
