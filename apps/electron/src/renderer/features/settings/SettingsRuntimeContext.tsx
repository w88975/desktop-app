import * as React from 'react'
import type { LlmConnectionWithStatus, Session, Workspace } from '../../../shared/types'

interface SettingsRuntimeValue {
  workspaceId: string | null
  workspaces: Workspace[]
  llmConnections: LlmConnectionWithStatus[]
  sessions: Session[]
  refreshWorkspaces(): Promise<void>
  refreshLlmConnections(): Promise<void>
  openAgentConversation(sessionId: string): Promise<void>
}

const SettingsRuntimeContext = React.createContext<SettingsRuntimeValue | null>(null)

export function SettingsRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null)
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([])
  const [llmConnections, setLlmConnections] = React.useState<LlmConnectionWithStatus[]>([])
  const [sessions, setSessions] = React.useState<Session[]>([])
  const appliedWorkspaceRef = React.useRef<string | null>(null)

  const refreshWorkspaces = React.useCallback(async () => {
    setWorkspaces(await window.electronAPI.getWorkspaces())
  }, [])

  const refreshLlmConnections = React.useCallback(async () => {
    setLlmConnections(await window.electronAPI.listLlmConnectionsWithStatus())
  }, [])

  const refreshWorkspaceData = React.useCallback(async () => {
    const [nextWorkspaces, nextConnections, nextSessions] = await Promise.all([
      window.electronAPI.getWorkspaces(),
      window.electronAPI.listLlmConnectionsWithStatus(),
      window.electronAPI.getSessions(),
    ])
    setWorkspaces(nextWorkspaces)
    setLlmConnections(nextConnections)
    setSessions(nextSessions)
  }, [])

  React.useEffect(() => {
    let disposed = false
    void window.settingsAppAPI.getContext().then(async context => {
      if (disposed) return
      appliedWorkspaceRef.current = context.workspaceId
      setWorkspaceId(context.workspaceId)
      while (!disposed) {
        try {
          await refreshWorkspaceData()
          if (!disposed) await window.settingsAppAPI.notifyReady()
          return
        } catch {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
    })

    const off = window.settingsAppAPI.onContextChanged(context => {
      if (context.workspaceId === appliedWorkspaceRef.current) return
      appliedWorkspaceRef.current = context.workspaceId
      void window.electronAPI.switchWorkspace(context.workspaceId).then(() => {
        if (disposed) return
        setWorkspaceId(context.workspaceId)
        return refreshWorkspaceData()
      })
    })
    return () => {
      disposed = true
      off()
    }
  }, [refreshWorkspaceData])

  React.useEffect(() => {
    const offConnections = window.electronAPI.onLlmConnectionsChanged(() => {
      void refreshLlmConnections()
    })
    const offSessions = window.electronAPI.onSessionEvent(() => {
      void window.electronAPI.getSessions().then(setSessions)
    })
    return () => {
      offConnections()
      offSessions()
    }
  }, [refreshLlmConnections])

  const value = React.useMemo<SettingsRuntimeValue>(() => ({
    workspaceId,
    workspaces,
    llmConnections,
    sessions,
    refreshWorkspaces,
    refreshLlmConnections,
    openAgentConversation: sessionId => window.settingsAppAPI.openAgentConversation(sessionId),
  }), [llmConnections, refreshLlmConnections, refreshWorkspaces, sessions, workspaceId, workspaces])

  return <SettingsRuntimeContext.Provider value={value}>{children}</SettingsRuntimeContext.Provider>
}

export function useSettingsRuntime(): SettingsRuntimeValue {
  const value = React.useContext(SettingsRuntimeContext)
  if (!value) throw new Error('useSettingsRuntime must be used within SettingsRuntimeProvider')
  return value
}

export function useSettingsWorkspace(): Workspace | null {
  const { workspaceId, workspaces } = useSettingsRuntime()
  return workspaces.find(workspace => workspace.id === workspaceId) ?? null
}
