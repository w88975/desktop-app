import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { sortLabelsForDisplay } from '@craft-agent/shared/labels'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import { useSession } from '@/hooks/useSession'
import { useLabels } from '@/hooks/useLabels'
import { useStatuses } from '@/hooks/useStatuses'
import { routes } from '@/lib/navigate'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'
import { useAgentPresentation } from '@/context/AgentPresentationContext'
import { useTheme } from '@/context/ThemeContext'
import { statusConfigsToSessionStatuses, type SessionStatus } from '@/config/session-status-config'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { MainContentPanel } from './MainContentPanel'

/**
 * Docked Agent presentation.
 *
 * Owns no sidebar, navigator, or multi-panel layout. It renders only current
 * conversation while reusing app-level stores/context, so session, messages,
 * drafts, permissions, and transport state stay synchronized with Full Agent.
 */
export function AgentPanel() {
  const { t } = useTranslation()
  const context = useAppShellContext()
  const { closePanel } = useAgentPresentation()
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)
  const [session] = useSession()
  const currentSessionId = focusedSessionId ?? session.selected

  const navState = useMemo(() => parseRouteToNavigationState(
    routes.view.allSessions(currentSessionId ?? undefined)
  ), [currentSessionId])

  const closeButton = useMemo(() => (
    <PanelHeaderCenterButton
      icon={<X className="h-4 w-4" />}
      onClick={() => { void closePanel() }}
      tooltip={t('common.close')}
    />
  ), [closePanel, t])

  // Workspace-scoped config for session menus (labels, dynamic statuses). App's raw
  // context omits these — FullAgentShell loads them internally, so the docked panel,
  // which never mounts FullAgentShell, must load its own copy. Without this the
  // session title menu renders with empty labels/statuses (missing 标签 row, empty
  // 状态 submenu).
  const { workspaces, activeWorkspaceId } = context
  const { labels: labelConfigs } = useLabels(activeWorkspaceId ?? null)
  const { statuses: statusConfigs } = useStatuses(activeWorkspaceId ?? null)
  const { isDark } = useTheme()
  const activeWorkspace = useMemo(
    () => workspaces.find(w => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  )

  // Convert StatusConfig to SessionStatus with resolved icons (same as FullAgentShell)
  const [sessionStatuses, setSessionStatuses] = useState<SessionStatus[]>([])
  useEffect(() => {
    if (!activeWorkspace?.id || statusConfigs.length === 0) {
      setSessionStatuses([])
      return
    }
    setSessionStatuses(statusConfigsToSessionStatuses(statusConfigs, activeWorkspace.id, isDark))
  }, [statusConfigs, activeWorkspace?.id, isDark])

  const labels = useMemo(() => sortLabelsForDisplay(labelConfigs), [labelConfigs])

  const handleSessionLabelsChange = useCallback(async (sessionId: string, sessionLabels: string[]) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setLabels', labels: sessionLabels })
      // Session will emit a 'labels_changed' event that updates the session state
    } catch (err) {
      console.error('[AgentPanel] Failed to set session labels:', err)
    }
  }, [])

  const panelContext = useMemo(() => ({
    ...context,
    rightSidebarButton: closeButton,
    leadingAction: undefined,
    isFocusedPanel: true,
    labels,
    sessionStatuses,
    onSessionLabelsChange: handleSessionLabelsChange,
  }), [context, closeButton, labels, sessionStatuses, handleSessionLabelsChange])

  return (
    <div
      data-agent-presentation="panel"
      data-agent-component="panel"
      className="h-full w-full min-w-0 overflow-hidden bg-background @container/shell"
    >
      <AppShellProvider value={panelContext}>
        <div className="h-full w-full min-w-0 overflow-hidden @container/panel">
          <MainContentPanel
            navStateOverride={navState}
            isSidebarAndNavigatorHidden
          />
        </div>
      </AppShellProvider>
    </div>
  )
}
